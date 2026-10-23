-- HR schema for the GitHub Pages + Supabase deployment.
-- Run only in the dedicated HR Supabase project. No employee rows are inserted here.

create table if not exists public.hr_users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[A-Za-z0-9_.-]{3,30}$'),
  name text not null,
  role text not null check (role in ('admin','editor','viewer')),
  created_at timestamptz not null default now()
);
create table if not exists public.employees (
  id text primary key,
  name text not null default '', joined date, shift text not null default '',
  type text not null default '', vendor text not null default '', line text not null default '',
  title text not null default '', manager text not null default '', gender text not null default '',
  status text not null default 'active' check (status in ('active','resigned')),
  resign_date date, resign_reason text not null default ''
);
create table if not exists public.leaves (
  id bigint generated always as identity primary key,
  emp_id text not null references public.employees(id), name text not null default '',
  line text not null default '', shift text not null default '', type text not null default '',
  code text not null, reason text not null default '', date date not null,
  unique(emp_id,date)
);
create table if not exists public.audit (
  id bigint generated always as identity primary key, at timestamptz not null default now(),
  username text not null, action text not null, detail text not null default ''
);
create table if not exists public.imports (
  id bigint generated always as identity primary key, at timestamptz not null default now(),
  username text not null, file text not null default '', summary jsonb not null default '{}'::jsonb
);
create index if not exists ix_employees_status on public.employees(status);
create index if not exists ix_leaves_date on public.leaves(date,emp_id);
create index if not exists ix_audit_at on public.audit(at desc);

-- The browser must never query private HR tables directly. All access is mediated by
-- the hr-api Edge Function, which verifies Supabase Auth and the user's role.
alter table public.hr_users enable row level security;
alter table public.employees enable row level security;
alter table public.leaves enable row level security;
alter table public.audit enable row level security;
alter table public.imports enable row level security;
revoke all on public.hr_users, public.employees, public.leaves, public.audit, public.imports from anon, authenticated;
grant all on public.hr_users, public.employees, public.leaves, public.audit, public.imports to service_role;
grant usage, select on all sequences in schema public to service_role;

create or replace function public.hr_apply_delta(p_body jsonb, p_username text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare item jsonb; pair record; emp_id text; e public.employees%rowtype;
begin
  for item in select value from jsonb_array_elements(coalesce(p_body->'adds','[]'::jsonb)) loop
    if coalesce(item->>0,'')='' or coalesce(item->>1,'')='' or coalesce(item->>2,'')='' or coalesce(item->>6,'')='' then raise exception 'Thiếu thông tin nhân viên'; end if;
    insert into employees(id,name,joined,shift,type,vendor,line,title,manager,gender,status)
    values(item->>0,item->>1,(item->>2)::date,coalesce(item->>3,''),coalesce(item->>4,''),coalesce(item->>5,''),coalesce(item->>6,''),coalesce(item->>7,''),coalesce(item->>8,''),coalesce(item->>9,''),'active');
    insert into audit(username,action,detail) values(p_username,'add_employee',(item->>0)||' '||(item->>1));
  end loop;
  for pair in select key,value from jsonb_each(coalesce(p_body->'res','{}'::jsonb)) loop
    emp_id:=pair.key; update employees set status='resigned',resign_date=(pair.value->>0)::date,resign_reason=coalesce(pair.value->>1,'') where id=emp_id and status='active';
    if not found then raise exception 'Không có nhân viên đang làm: %',emp_id; end if;
    insert into audit(username,action,detail) values(p_username,'resign',emp_id||' '||(pair.value->>0));
  end loop;
  for item in select value from jsonb_array_elements(coalesce(p_body->'restore','[]'::jsonb)) loop
    update employees set status='active',resign_date=null,resign_reason='' where id=item#>>'{}';
    if not found then raise exception 'Không có nhân viên để khôi phục: %',item#>>'{}'; end if;
    insert into audit(username,action,detail) values(p_username,'restore',item#>>'{}');
  end loop;
  for item in select value from jsonb_array_elements(coalesce(p_body->'leaves','[]'::jsonb)) loop
    emp_id:=item->>0; select * into e from employees where id=emp_id;
    if not found or coalesce(item->>7,'')='' or coalesce(item->>5,'')='' then raise exception 'Thiếu thông tin nghỉ: %',emp_id; end if;
    insert into leaves(emp_id,name,line,shift,type,code,reason,date) values(e.id,e.name,e.line,e.shift,e.type,item->>5,coalesce(item->>6,''),(item->>7)::date) on conflict(emp_id,date) do nothing;
    insert into audit(username,action,detail) values(p_username,'leave',emp_id||' '||(item->>7)||' '||(item->>5));
  end loop;
  for pair in select value from jsonb_array_elements(coalesce(p_body->'delL','[]'::jsonb)) loop
    delete from leaves where emp_id=pair.value->>0 and date=(pair.value->>1)::date;
    insert into audit(username,action,detail) values(p_username,'delete_leave',(pair.value->>0)||' '||(pair.value->>1));
  end loop;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.hr_apply_delta(jsonb,text) from public, anon, authenticated;
grant execute on function public.hr_apply_delta(jsonb,text) to service_role;

create or replace function public.hr_commit_import(p_adds jsonb,p_res jsonb,p_leaves jsonb,p_username text,p_file text,p_summary jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare before_counts jsonb; after_counts jsonb; r jsonb; e public.employees%rowtype;
begin
  select jsonb_build_object('active',count(*) filter(where status='active'),'resigned',count(*) filter(where status='resigned')) into before_counts from employees;
  before_counts:=before_counts||jsonb_build_object('leaves',(select count(*) from leaves));
  for r in select value from jsonb_array_elements(coalesce(p_adds,'[]'::jsonb)) loop
    insert into employees(id,name,joined,shift,type,vendor,line,title,manager,gender,status)
    values(r->>'id',r->>'name',(r->>'joined')::date,r->>'shift',r->>'type',coalesce(r->>'vendor',''),r->>'line',coalesce(r->>'title',''),coalesce(r->>'manager',''),coalesce(r->>'gender',''),'active');
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_res,'[]'::jsonb)) loop
    update employees set status='resigned',resign_date=(r->>'date')::date,resign_reason=coalesce(r->>'reason','') where id=r->>'id' and status='active';
    if not found then raise exception 'Nhân viên không còn trạng thái đang làm: %',r->>'id'; end if;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(p_leaves,'[]'::jsonb)) loop
    select * into e from employees where id=r->>'id';
    if not found then raise exception 'Không tìm thấy nhân viên: %',r->>'id'; end if;
    insert into leaves(emp_id,name,line,shift,type,code,reason,date) values(e.id,e.name,e.line,e.shift,e.type,r->>'code',coalesce(r->>'reason',''),(r->>'date')::date) on conflict(emp_id,date) do nothing;
  end loop;
  select jsonb_build_object('active',count(*) filter(where status='active'),'resigned',count(*) filter(where status='resigned')) into after_counts from employees;
  after_counts:=after_counts||jsonb_build_object('leaves',(select count(*) from leaves));
  insert into imports(username,file,summary) values(p_username,coalesce(p_file,''),p_summary||jsonb_build_object('before',before_counts,'after',after_counts));
  insert into audit(username,action,detail) values(p_username,'import',coalesce(p_file,'')||': import hoàn tất');
  return jsonb_build_object('ok',true,'before',before_counts,'after',after_counts);
end $$;
revoke all on function public.hr_commit_import(jsonb,jsonb,jsonb,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.hr_commit_import(jsonb,jsonb,jsonb,text,text,jsonb) to service_role;

