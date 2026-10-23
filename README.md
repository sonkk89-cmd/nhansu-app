# Nhân sự nội bộ — GitHub Pages + Supabase

Bản này thay ứng dụng đi tuần hiện tại bằng ứng dụng nhân sự tại trang chính của repository. Tệp trong `site/` là nội dung website; thư mục `supabase/` chứa migration và Edge Function. Không có cơ sở dữ liệu nhân sự hoặc mật khẩu cũ trong gói.

## Supabase

Project URL: `https://rhcnogepfjvcikhvfubx.supabase.co`  
Project ref: `rhcnogepfjvcikhvfubx`

1. Tắt đăng ký email công khai trong Authentication settings.
2. Mở SQL Editor và chạy `supabase/migrations/001_hr_schema.sql`. Migration tạo bảng HR trống, bật RLS và không cấp quyền trực tiếp cho `anon`/`authenticated`.
3. Cài Supabase CLI và triển khai function:

   ```powershell
   npx supabase login
   npx supabase functions deploy hr-api --project-ref rhcnogepfjvcikhvfubx
   ```

   `supabase/config.toml` đặt `verify_jwt = false` để route đăng nhập công khai tới được function. Function tự xác minh Supabase Auth cho mọi route dữ liệu. Khóa server chỉ được đọc từ môi trường Edge Function, không nằm trong mã nguồn website.

4. Tạo user đầu tiên trong Authentication → Users → Add user, email `admin@hr.internal`, mật khẩu mạnh và xác nhận email. Sau đó chạy một lần:

   ```sql
   insert into public.hr_users(id, username, name, role)
   select id, 'admin', 'Quản trị viên', 'admin'
   from auth.users where email = 'admin@hr.internal'
   on conflict (id) do update set username = excluded.username, name = excluded.name, role = 'admin';
   ```

   Đăng nhập app bằng username `admin` và mật khẩu vừa đặt. Admin có thể tạo các tài khoản khác trong app.

## GitHub Pages

Sao chép nội dung `site/` vào thư mục gốc của repository hiện tại, thay `index.html` cũ của app đi tuần bằng `site/index.html`, và xóa `factory.jpg` cùng `layout.png` nếu không còn được dùng ở nơi khác. GitHub Pages sẽ mở app nhân sự tại URL gốc:

`https://mrhothang-ai.github.io/Audit_hien_truong_ILS/`

Cần commit `supabase/` cùng repository để quản lý mã migration/function. Publishable key nằm trong `site/config.js` và được thiết kế để public; dữ liệu vẫn bị khóa trong database và chỉ Edge Function được phép truy cập.

## Dữ liệu và tài khoản

ZIP app ban đầu không chứa `data/hr.db`; tạo lại tài khoản trong Supabase Auth và nhập dữ liệu qua chức năng Excel sau khi triển khai. Mật khẩu cũ không thể chuyển vì được băm bằng cơ chế khác.

