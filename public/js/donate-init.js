(function () {
  const donateRoot = document.getElementById("donate-root");

  if (!donateRoot || !window.renderDonatePage) {
    return;
  }

  window.renderDonatePage(donateRoot, {
    isAuthenticated: donateRoot.dataset.authenticated === "true",
    donorDashboardUrl: "/donor",
    loginUrl: "/login",
    supportEmail: "kai@getkinder.ai"
  });
})();
