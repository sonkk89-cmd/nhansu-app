-- Admin-only employee deletion operations. Both functions are transactional.
create or replace function public.hr_delete_employee(p_id text, p_username text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare employee_name text; leave_count integer := 0;
begin
  select name into employee_name from public.employees where id = p_id for update;
  if not found then raise exception 'Không tìm thấy nhân viên có mã %', p_id; end if;
  delete from public.leaves where emp_id = p_id;
  get diagnostics leave_count = row_count;
  delete from public.employees where id = p_id;
  insert into public.audit(username, action, detail)
  values (p_username, 'employee_delete', p_id || ' ' || coalesce(employee_name, '') || '; lượt nghỉ đã xóa: ' || leave_count);
  return jsonb_build_object('ok', true, 'id', p_id, 'removed', jsonb_build_object('employees', 1, 'leaves', leave_count));
end;
$$;
revoke all on function public.hr_delete_employee(text, text) from public, anon, authenticated;
grant execute on function public.hr_delete_employee(text, text) to service_role;

-- Bulk deletion intentionally preserves hr_users, audit, and imports.
create or replace function public.hr_delete_all_employees(p_username text, p_confirmation text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare employee_count integer := 0; leave_count integer := 0;
begin
  if coalesce(trim(p_confirmation), '') <> 'XÓA TOÀN BỘ NHÂN VIÊN' then raise exception 'Cụm từ xác nhận không hợp lệ'; end if;
  select count(*) into employee_count from public.employees;
  select count(*) into leave_count from public.leaves;
  delete from public.leaves;
  delete from public.employees;
  insert into public.audit(username, action, detail)
  values (p_username, 'employee_delete_all', 'Đã xóa ' || employee_count || ' hồ sơ nhân viên và ' || leave_count || ' lượt nghỉ; giữ nguyên tài khoản, nhật ký và lịch sử nhập Excel');
  return jsonb_build_object('ok', true, 'removed', jsonb_build_object('employees', employee_count, 'leaves', leave_count));
end;
$$;
revoke all on function public.hr_delete_all_employees(text, text) from public, anon, authenticated;
grant execute on function public.hr_delete_all_employees(text, text) to service_role;
