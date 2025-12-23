export const languages = {
    // 기본 및 아시아 주요 언어
    "ko": "한국어",
    "en": "English",
    "ja": "日本語",       // 일본어
    "zh-CN": "简体中文",   // 중국어(간체)
    "zh-TW": "繁體中文",   // 중국어(정체)

    // 유럽
    "de": "Deutsch",     // 독일어
    "es": "Español",     // 스페인어
    "fr": "Français",    // 프랑스어
    "it": "Italiano",    // 이탈리아어
    "pt": "Português",   // 포르투갈어
    "ru": "Русский",     // 러시아어
    "nl": "Nederlands",  // 네덜란드어

    // 중동
    "ar": "العربية",      // 아랍어
    "tr": "Türkçe",      // 터키어
    "fa": "فارسی",        // 페르시아어(이란어)

    // 중앙아시아
    "uz": "Oʻzbekcha",   // 우즈베크어

    // 동남아시아
    "id": "Bahasa Indonesia", // 인도네시아어
    "ms": "Bahasa Melayu",    // 말레이어
    "th": "ไทย",            // 태국어
    "vi": "Tiếng Việt",       // 베트남어
    "tl": "Filipino"          // 필리핀어
};

let currentTranslations = {};
let currentLang = 'ko';

export function getLanguage() {
    return currentLang;
}

export function getTranslations() {
    return currentTranslations;
}

export async function loadLanguage(langCode) {
    try {
        const response = await fetch(`translations/${langCode}.json`);
        if (!response.ok) throw new Error(`Status: ${response.status}`);
        const translations = await response.json();
        currentTranslations = translations;
        currentLang = langCode;
        localStorage.setItem('selectedLanguage', langCode);
        return translations;
    } catch (error) {
        console.error(error);
        return null; // Handle error in caller
    }
}

export function translate(key) {
    return currentTranslations[key] || key;
}

export function updatePageText(translations) {
    document.querySelectorAll('[data-translate]').forEach(element => {
        const key = element.getAttribute('data-translate');
        if (translations[key]) element.textContent = translations[key];
    });
    if (translations.pageTitleApp) document.title = translations.pageTitleApp;
}
