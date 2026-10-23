window.HRCloud = {
  async api(path, options = {}) {
    const token = localStorage.getItem("hr_access_token") || "";
    const headers = new Headers(options.headers || {});
    headers.set("apikey", window.HR_CONFIG.publishableKey);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(window.HR_CONFIG.apiUrl + path, { ...options, headers });
    if (response.status === 401 && !path.endsWith("/login")) {
      localStorage.removeItem("hr_access_token");
      window.location.href = window.HR_CONFIG.basePath + "login.html";
    }
    return response;
  },
  logout(event) {
    if (event) event.preventDefault();
    localStorage.removeItem("hr_access_token");
    window.location.href = window.HR_CONFIG.basePath + "login.html";
  }
};

