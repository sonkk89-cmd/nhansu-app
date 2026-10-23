-- Update an active employee and record the change atomically.
create or replace function public.hr_update_employee(
  p_id text, p_name text, p_joined date, p_shift text, p_type text,
  p_vendor text, p_line text, p_title text, p_manager text, p_gender text,
  p_username text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_row public.employees%rowtype;
  new_row public.employees%rowtype;
  changed text;
begin
  select * into old_row from public.employees
  where id = p_id and status = 'active'
  for update;
  if not found then
    raise exception 'Không tìm thấy nhân viên đang làm việc có mã %', p_id;
  end if;

  update public.employees set
    name = p_name, joined = p_joined, shift = p_shift, type = p_type,
    vendor = p_vendor, line = p_line, title = p_title,
    manager = p_manager, gender = p_gender
  where id = p_id and status = 'active'
  returning * into new_row;

  changed := concat_ws(', ',
    case when old_row.name is distinct from new_row.name then 'Họ tên' end,
    case when old_row.joined is distinct from new_row.joined then 'Ngày vào' end,
    case when old_row.shift is distinct from new_row.shift then 'Ca' end,
    case when old_row.type is distinct from new_row.type then 'Loại nhân lực' end,
    case when old_row.vendor is distinct from new_row.vendor then 'Vendor' end,
    case when old_row.line is distinct from new_row.line then 'Line' end,
    case when old_row.title is distinct from new_row.title then 'Chức vụ' end,
    case when old_row.manager is distinct from new_row.manager then 'Quản lý' end,
    case when old_row.gender is distinct from new_row.gender then 'Giới tính' end
  );
  insert into public.audit(username, action, detail)
  values (p_username, 'employee_edit', p_id || ': ' || coalesce(nullif(changed, ''), 'không thay đổi nội dung'));

  return jsonb_build_object('ok', true, 'id', new_row.id, 'changed', changed);
end;
$$;

revoke all on function public.hr_update_employee(text,text,date,text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.hr_update_employee(text,text,date,text,text,text,text,text,text,text,text) to service_role;
