// Språk i panelen: svenska eller engelska.
// Använd t('Svensk text', 'English text') i komponenterna – det uppdateras direkt när språket byts.
export const i18n = $state({ lang: 'en' });

export function t(sv, en) {
	return i18n.lang === 'sv' ? sv : en;
}

export function setLang(lang) {
	i18n.lang = lang === 'sv' ? 'sv' : 'en';
	try {
		document.documentElement.lang = i18n.lang;
	} catch {
		/* */
	}
}
