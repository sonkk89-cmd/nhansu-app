// Public browser configuration. This publishable key is intentionally public.
// Keep all HR table access behind the authenticated hr-api Edge Function.
window.HR_CONFIG = {
  supabaseUrl: "https://rhcnogepfjvcikhvfubx.supabase.co",
  publishableKey: "sb_publishable_xz-BN-fAj16fcbmduEBbgg_WGuDjb-G",
  get apiUrl() { return this.supabaseUrl + "/functions/v1/hr-api"; },
  get basePath() {
    const p = window.location.pathname;
    const marker = "/nhansu/";
    const i = p.indexOf(marker);
    if (i >= 0) return p.slice(0, i + marker.length);
    return p.slice(0, p.lastIndexOf("/") + 1);
  }
};

