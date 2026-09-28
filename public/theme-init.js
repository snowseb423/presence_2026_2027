// Applique le thème choisi (clair / sombre / système) avant le premier rendu,
// pour éviter un flash de la mauvaise palette. Fichier externe : compatible CSP.
;(function () {
  try {
    var theme = localStorage.getItem('presence:theme')
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme)
    }
  } catch (e) {
    /* stockage indisponible : on suit le système */
  }
})()
