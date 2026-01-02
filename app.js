(() => {
  const elStatus = document.getElementById('status');
  if (elStatus) elStatus.textContent = 'app.js is running ✅ ' + new Date().toISOString();
  alert('app.js is running ✅');
})();
