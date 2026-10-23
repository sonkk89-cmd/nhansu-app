# Ứng dụng nhân sự

Repo này chỉ chứa ứng dụng nhân sự. Website dùng GitHub Pages; dữ liệu và đăng nhập dùng Supabase.

## Bật website

Trong GitHub mở **Settings → Pages**. Ở **Build and deployment**, chọn **Deploy from a branch**, nhánh `main`, thư mục `/(root)`, rồi **Save**. Sau khi GitHub Pages hoàn tất triển khai, địa chỉ website là:

`https://sonkk89-cmd.github.io/nhansu-app/`

## Cấu hình Supabase

Project URL: `https://rhcnogepfjvcikhvfubx.supabase.co`  
Project ref: `rhcnogepfjvcikhvfubx`

1. Trong Authentication settings, tắt đăng ký công khai.
2. Mở SQL Editor và chạy `supabase/migrations/001_hr_schema.sql`. Migration tạo các bảng HR trống, bật RLS và không cấp quyền truy cập bảng trực tiếp cho `anon`/`authenticated`.
3. Chạy thêm migration `supabase/migrations/002_employee_edit.sql` trong SQL Editor để bật sửa nhân viên có nhật ký.
4. Cài Supabase CLI rồi triển khai Edge Function:

   ```powershell
   npx supabase login
   npx supabase functions deploy hr-api --project-ref rhcnogepfjvcikhvfubx
   ```

   Function dùng `SUPABASE_SERVICE_ROLE_KEY` ở môi trường máy chủ; khóa này không nằm trong website.

5. Tạo tài khoản đầu tiên trong **Authentication → Users → Add user** bằng email `admin@hr.internal`, mật khẩu mạnh và xác nhận email. Sau đó chạy một lần trong SQL Editor:

   ```sql
   insert into public.hr_users(id, username, name, role)
   select id, 'admin', 'Quản trị viên', 'admin'
   from auth.users where email = 'admin@hr.internal'
   on conflict (id) do update set username = excluded.username, name = excluded.name, role = 'admin';
   ```

   Đăng nhập bằng username `admin` và mật khẩu vừa đặt. Admin có thể tạo tài khoản khác trong ứng dụng.

## Dữ liệu

Gói app ban đầu không có `data/hr.db`, nên dữ liệu nhân sự và tài khoản cũ không được chuyển sang. Sau khi cấu hình Supabase, hãy đăng nhập admin và nhập dữ liệu bằng chức năng Excel.

Publishable key trong `config.js` được thiết kế để xuất hiện ở trình duyệt. Không đưa `service_role` key hoặc mật khẩu vào repo.

