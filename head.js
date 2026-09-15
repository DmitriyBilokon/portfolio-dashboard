// До первой отрисовки (синхронно в <head>): тема и html.desk — без вспышки светлой темы. Регистрация SW — после load.
// Отдельный файл, а не инлайн: CSP без 'unsafe-inline' в script-src (блок B, plans/esc-csp-b.md).
(function(){var de=document.documentElement;de.classList.add('desk');try{de.dataset.theme=localStorage.getItem('dash_theme')||'dark'}catch(e){de.dataset.theme='dark'}})();
if('serviceWorker' in navigator)addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){})});
