import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const allowed = new Set([
  "https://sonkk89-cmd.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const headers = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowed.has(origin) ? origin : "https://sonkk89-cmd.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json; charset=utf-8",
});
const reply = (data: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: headers(origin) });
const fail = (message: string, status = 400, origin: string | null = null) => reply({ error: message }, status, origin);
const roleSet = new Set(["admin", "editor", "viewer"]);
const usernameEmail = (name: string) => `${name.toLowerCase()}@hr.internal`;
const countRows = async (table: string, query: (q: any) => any = q => q) => {
  const { count, error } = await query(admin.from(table).select("*", { count: "exact", head: true }));
  if (error) throw error;
  return count || 0;
};
async function currentUser(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("Chưa đăng nhập"), { status: 401 });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw Object.assign(new Error("Phiên đăng nhập hết hạn"), { status: 401 });
  const { data: profile, error: pe } = await admin.from("hr_users").select("id,username,name,role").eq("id", data.user.id).maybeSingle();
  if (pe || !profile) throw Object.assign(new Error("Tài khoản chưa được cấp quyền trong hệ thống nhân sự"), { status: 403 });
  return profile as { id: string; username: string; name: string; role: string };
}
const requireRole = (u: { role: string }, roles: string[]) => {
  if (!roles.includes(u.role)) throw Object.assign(new Error("Bạn không có quyền thực hiện thao tác này"), { status: 403 });
};
async function audit(username: string, action: string, detail: string) {
  const { error } = await admin.from("audit").insert({ username, action, detail });
  if (error) throw error;
}
const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().trim();
function dateValue(v: unknown) {
  if (v === "" || v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const s = String(v).trim(), m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  const iso = m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "");
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : "";
}
async function validateImport(body: any) {
  const [er, lr] = await Promise.all([
    admin.from("employees").select("*"),
    admin.from("leaves").select("emp_id,date"),
  ]);
  if (er.error) throw er.error;
  if (lr.error) throw lr.error;
  const employees = er.data || [], existing = new Map(employees.map((e: any) => [e.id, e]));
  const lines = new Set(employees.map((e: any) => e.line).filter(Boolean));
  const vendors = new Set(employees.map((e: any) => e.vendor).filter(Boolean));
  const leaveKeys = new Set((lr.data || []).map((l: any) => `${l.emp_id}|${l.date}`));
  const R: any = Object.fromEntries(["adds", "res", "leaves"].map(k => [k, { total: 0, rows: [], errors: [], warnings: [], skipped: 0 }]));
  const SHIFTS = ["A", "C", "HC"], TYPES = ["Chính thức", "Thời vụ", "Sinh viên"], CODES = ["P", "TD", "R", "RCC", "O", "Stop", "ĐM"];
  const today = new Date().toISOString().slice(0, 10), in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const err = (k: string, row: number, msg: string) => R[k].errors.push({ row, msg });
  const warn = (k: string, row: number, msg: string) => R[k].warnings.push({ row, msg });
  for (const { row, v } of body.adds || []) {
    const id = String(v?.[0] ?? "").trim(); if (/^VD/i.test(id)) { R.adds.skipped++; continue; } R.adds.total++;
    const name = String(v?.[1] ?? "").trim(), joined = dateValue(v?.[2]), shift = SHIFTS.find(x => norm(x) === norm(v?.[3])), type = TYPES.find(x => norm(x) === norm(v?.[4]));
    const vendor = String(v?.[5] ?? "").trim(), line = String(v?.[6] ?? "").trim(), manager = String(v?.[8] ?? "").trim();
    if (!id) { err("adds", row, "Thiếu Mã NV"); continue; }
    if (!name) { err("adds", row, `Mã ${id}: thiếu Họ tên`); continue; }
    if (!joined) { err("adds", row, `Mã ${id}: Ngày vào trống hoặc sai định dạng`); continue; }
    if (!shift) { err("adds", row, `Mã ${id}: Ca không hợp lệ (A, C, HC)`); continue; }
    if (!type) { err("adds", row, `Mã ${id}: Loại nhân lực không hợp lệ`); continue; }
    if (!line) { err("adds", row, `Mã ${id}: thiếu Line`); continue; }
    if (existing.has(id)) { err("adds", row, `Mã ${id}: đã có trong hệ thống`); continue; }
    if (!lines.has(line)) warn("adds", row, `Mã ${id}: Line "${line}" chưa từng có trong hệ thống`);
    if (type === "Thời vụ" && !vendor) warn("adds", row, `Mã ${id}: Thời vụ nhưng chưa ghi Vendor`);
    else if (vendor && !vendors.has(vendor)) warn("adds", row, `Mã ${id}: Vendor "${vendor}" chưa từng có trong hệ thống`);
    if (!manager) warn("adds", row, `Mã ${id}: chưa có tên quản lý (Leader)`);
    if (joined > in30) warn("adds", row, `Mã ${id}: ngày vào ở xa trong tương lai`);
    const rec = { id, name, joined, shift, type, vendor, line, title: String(v?.[7] ?? "").trim(), manager, gender: String(v?.[9] ?? "").trim() };
    R.adds.rows.push(rec); existing.set(id, { ...rec, status: "active" });
  }
  const seenR = new Set<string>();
  for (const { row, v } of body.res || []) {
    const id = String(v?.[0] ?? "").trim(); if (/^VD/i.test(id)) { R.res.skipped++; continue; } R.res.total++;
    const date = dateValue(v?.[1]), e: any = existing.get(id);
    if (!id) { err("res", row, "Thiếu Mã NV"); continue; }
    if (!e) { err("res", row, `Mã ${id}: không có trong hệ thống`); continue; }
    if (e.status !== "active" || seenR.has(id)) { err("res", row, `Mã ${id}: đã nghỉ việc hoặc nhập trùng`); continue; }
    if (!date) { err("res", row, `Mã ${id}: Ngày nghỉ trống hoặc sai định dạng`); continue; }
    if (e.joined && date < e.joined) warn("res", row, `Mã ${id}: ngày nghỉ trước ngày vào làm`);
    if (date > in30) warn("res", row, `Mã ${id}: ngày nghỉ ở xa trong tương lai`);
    R.res.rows.push({ id, date, reason: String(v?.[2] ?? "").trim() }); seenR.add(id); existing.set(id, { ...e, status: "resigned", resign_date: date });
  }
  const seenL = new Set<string>();
  for (const { row, v } of body.leaves || []) {
    const id = String(v?.[1] ?? "").trim(); if (/^VD/i.test(id)) { R.leaves.skipped++; continue; } R.leaves.total++;
    const date = dateValue(v?.[0]), e: any = existing.get(id), code = CODES.find(x => norm(x) === norm(v?.[2]));
    if (!id) { err("leaves", row, "Thiếu Mã NV"); continue; }
    if (!e) { err("leaves", row, `Mã ${id}: không có trong hệ thống`); continue; }
    if (!date) { err("leaves", row, `Mã ${id}: Ngày trống hoặc sai định dạng`); continue; }
    if (!code) { err("leaves", row, `Mã ${id}: Loại nghỉ không hợp lệ`); continue; }
    const key = `${id}|${date}`;
    if (seenL.has(key) || leaveKeys.has(key)) { R.leaves.skipped++; warn("leaves", row, `Mã ${id} ngày ${date}: đã có, bỏ qua`); continue; }
    if (e.joined && date < e.joined) warn("leaves", row, `Mã ${id}: ngày nghỉ trước ngày vào làm`);
    if (e.status === "resigned" && e.resign_date && date > e.resign_date) warn("leaves", row, `Mã ${id}: ngày nghỉ sau ngày nghỉ việc`);
    if (date > in30) warn("leaves", row, `Mã ${id}: ngày nghỉ ở xa trong tương lai`);
    R.leaves.rows.push({ id, date, code, reason: String(v?.[3] ?? "").trim() }); seenL.add(key);
  }
  return R;
}

Deno.serve(async req => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  try {
    const url = new URL(req.url), route = url.pathname.split("/hr-api")[1] || "/", method = req.method;
    if (method === "POST" && route === "/api/login") {
      const body = await req.json(), username = String(body.username || "").trim();
      if (!username || !body.password) return fail("Nhập tài khoản và mật khẩu", 400, origin);
      const client = createClient(URL, ANON, { auth: { persistSession: false } });
      const { data, error } = await client.auth.signInWithPassword({ email: usernameEmail(username), password: String(body.password) });
      if (error || !data.session) return fail("Sai tài khoản hoặc mật khẩu", 401, origin);
      const { data: profile } = await admin.from("hr_users").select("username,name,role").eq("id", data.user.id).maybeSingle();
      if (!profile) return fail("Tài khoản chưa được cấp quyền trong hệ thống nhân sự", 403, origin);
      return reply({ ok: true, token: data.session.access_token, user: profile }, 200, origin);
    }
    const user = await currentUser(req);
    if (method === "GET" && route === "/api/data") {
      const [a, r, l] = await Promise.all([
        admin.from("employees").select("*").eq("status", "active").order("id"),
        admin.from("employees").select("*").eq("status", "resigned").order("resign_date", { ascending: false }),
        admin.from("leaves").select("*").order("date").order("emp_id"),
      ]);
      if (a.error || r.error || l.error) throw a.error || r.error || l.error;
      const rowE = (e: any) => [e.id,e.name,e.joined,e.shift,e.type,e.vendor,e.line,e.title,e.manager,e.gender];
      const rowR = (e: any) => [e.id,e.name,e.joined,e.shift,e.type,e.vendor,e.line,e.resign_date,e.resign_reason,1];
      const rowL = (e: any) => [e.emp_id,e.name,e.line,e.shift,e.type,e.code,e.reason,e.date];
      return reply({ me: { username: user.username, name: user.name, role: user.role }, E: (a.data||[]).map(rowE), R: (r.data||[]).map(rowR), L: (l.data||[]).map(rowL) }, 200, origin);
    }
    if (method === "POST" && route === "/api/delta") {
      requireRole(user, ["admin", "editor"]); const body = await req.json();
      const { data, error } = await admin.rpc("hr_apply_delta", { p_body: body, p_username: user.username });
      if (error) throw error; return reply(data, 200, origin);
    }
    if (route === "/api/users" && method === "GET") {
      requireRole(user, ["admin"]); const { data, error } = await admin.from("hr_users").select("username,name,role").order("username");
      if (error) throw error; return reply(data, 200, origin);
    }
    if (route === "/api/users" && method === "POST") {
      requireRole(user, ["admin"]); const b = await req.json(), username = String(b.username||"").trim(), name = String(b.name||"").trim() || username;
      if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username) || !roleSet.has(b.role)) return fail("Tên đăng nhập hoặc vai trò không hợp lệ", 400, origin);
      const { data: ex } = await admin.from("hr_users").select("id,username,name,role").eq("username",username).maybeSingle();
      if ((!ex || b.password) && String(b.password||"").length < 8) return fail("Mật khẩu phải từ 8 ký tự trở lên", 400, origin);
      if (ex?.role === "admin" && b.role !== "admin") {
        if (username === user.username) return fail("Không thể tự hạ quyền chính mình", 400, origin);
        const { count } = await admin.from("hr_users").select("id",{count:"exact",head:true}).eq("role","admin");
        if ((count||0) <= 1) return fail("Phải còn ít nhất một tài khoản admin", 400, origin);
      }
      let uid = ex?.id;
      if (!ex) {
        const { data: created, error } = await admin.auth.admin.createUser({ email: usernameEmail(username), password: String(b.password), email_confirm: true });
        if (error) throw error; uid = created.user.id;
      } else if (b.password) {
        const { error } = await admin.auth.admin.updateUserById(uid, { password: String(b.password) }); if (error) throw error;
      }
      const { error } = await admin.from("hr_users").upsert({ id: uid, username, name, role: b.role }); if (error) throw error;
      await audit(user.username,"user_save",`${username} (${b.role})${b.password ? " đổi mật khẩu" : ""}`);
      return reply({ok:true},200,origin);
    }
    const delUser = route.match(/^\/api\/users\/([^/]+)$/);
    if (method === "DELETE" && delUser) {
      requireRole(user,["admin"]); const username = decodeURIComponent(delUser[1]);
      const { data: target } = await admin.from("hr_users").select("id,role").eq("username",username).maybeSingle();
      if (!target) return fail("Không có tài khoản này",404,origin);
      if (username === user.username) return fail("Không thể xóa chính mình",400,origin);
      if (target.role === "admin") { const {count}=await admin.from("hr_users").select("id",{count:"exact",head:true}).eq("role","admin"); if ((count||0)<=1) return fail("Phải còn ít nhất một tài khoản admin",400,origin); }
      const {error}=await admin.auth.admin.deleteUser(target.id); if(error) throw error;
      await audit(user.username,"user_delete",username); return reply({ok:true},200,origin);
    }
    if (route === "/api/import/preview" && method === "POST") {
      requireRole(user,["admin","editor"]); const result=await validateImport(await req.json());
      const slim:any={}; for(const k of ["adds","res","leaves"]) slim[k]={total:result[k].total,ok:result[k].rows.length,errors:result[k].errors,warnings:result[k].warnings,skipped:result[k].skipped};
      return reply(slim,200,origin);
    }
    if (route === "/api/import/commit" && method === "POST") {
      requireRole(user,["admin","editor"]); const b=await req.json(), v=await validateImport(b), n=v.adds.rows.length+v.res.rows.length+v.leaves.rows.length;
      if (!n) return fail("Không có dòng hợp lệ nào để nhập. Chưa có gì được ghi.",400,origin);
      const summary={ok:{adds:v.adds.rows.length,res:v.res.rows.length,leaves:v.leaves.rows.length},errors:["adds","res","leaves"].reduce((s,k)=>s+v[k].errors.length,0),warnings:["adds","res","leaves"].reduce((s,k)=>s+v[k].warnings.length,0),errorSamples:["adds","res","leaves"].flatMap(k=>v[k].errors.map((e:any)=>({sheet:k,...e}))).slice(0,30)};
      const {data,error}=await admin.rpc("hr_commit_import",{p_adds:v.adds.rows,p_res:v.res.rows,p_leaves:v.leaves.rows,p_username:user.username,p_file:String(b.file||""),p_summary:summary});
      if(error) throw error;
      return reply({...data,done:{adds:v.adds.rows.length,res:v.res.rows.length,leaves:v.leaves.rows.length},errors:summary.errors,skipped:v.adds.skipped+v.res.skipped+v.leaves.skipped},200,origin);
    }
    if (route === "/api/imports" && method === "GET") {
      requireRole(user,["admin"]); const {data,error}=await admin.from("imports").select("*").order("id",{ascending:false}).limit(50); if(error)throw error;
      return reply((data||[]).map((x:any)=>({id:x.id,at:x.at,user:x.username,file:x.file,summary:x.summary})),200,origin);
    }
    if (route === "/api/audit" && method === "GET") {
      requireRole(user,["admin"]); const {data,error}=await admin.from("audit").select("*").order("id",{ascending:false}).limit(500); if(error)throw error;
      return reply((data||[]).map((x:any)=>({id:x.id,at:x.at,user:x.username,action:x.action,detail:x.detail})),200,origin);
    }
    if (route === "/api/checks" && method === "GET") {
      requireRole(user,["admin"]);
      const {data:emps,error}=await admin.from("employees").select("*"); if(error)throw error;
      const {data:leaves,error:le}=await admin.from("leaves").select("*"); if(le)throw le;
      const E=emps||[],L=leaves||[], active=E.filter((e:any)=>e.status==="active"), resigned=E.filter((e:any)=>e.status==="resigned"), by=(label:string,rows:any[])=>({label,count:rows.length,sample:rows.slice(0,8).map((r:any)=>`${r.id||r.emp_id} ${r.name||r.date}`)});
      const items=[by("Đang làm: chưa có Line",active.filter((e:any)=>!e.line)),by("Đang làm: chưa có tên quản lý (Leader)",active.filter((e:any)=>!e.manager)),by("Đang làm: chưa có giới tính",active.filter((e:any)=>!e.gender)),by("Đang làm: Ca không hợp lệ",active.filter((e:any)=>!["A","C","HC"].includes(e.shift))),by("Đang làm: Loại nhân lực không hợp lệ",active.filter((e:any)=>!["Chính thức","Thời vụ","Sinh viên"].includes(e.type))),by("Đang làm: Thời vụ chưa ghi Vendor",active.filter((e:any)=>e.type==="Thời vụ"&&!e.vendor)),by("Đã nghỉ việc nhưng thiếu ngày nghỉ",resigned.filter((e:any)=>!e.resign_date)),by("Ngày nghỉ trước ngày vào làm",L.filter((l:any)=>{const e=E.find((x:any)=>x.id===l.emp_id);return e?.joined&&l.date<e.joined;}))];
      return reply({at:new Date().toISOString(),counts:{active:active.length,resigned:resigned.length,leaves:L.length},items},200,origin);
    }
    return fail("Không tìm thấy API",404,origin);
  } catch (e) {
    const status = Number((e as any)?.status) || 400;
    return fail((e as any)?.message || "Lỗi máy chủ", status, origin);
  }
});

