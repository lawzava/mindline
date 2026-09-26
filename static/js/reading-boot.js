// Reading settings before first paint (DESIGN.md "Reading mode"): a
// returning reader's text size and contrast apply before anything renders,
// so large text never flashes small first. A static file, not an inline
// script, so the CSP needs no new hash. It mirrors parseReading and
// applyReading in src/lib/stores/reading.ts (tests/unit/reading-boot.test.ts
// holds the two to the same result).
(function () {
	var root = document.documentElement;
	var settings;
	try {
		settings = JSON.parse(localStorage.getItem('mindline_reading') || 'null');
	} catch (e) {
		return;
	}
	if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
	if (settings.textSize === 'large' || settings.textSize === 'xlarge') {
		root.setAttribute('data-reading', settings.textSize);
	}
	if (settings.highContrast === true) root.setAttribute('data-contrast', 'high');
})();
