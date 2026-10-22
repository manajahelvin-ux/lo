/**
 * Ubepro — Landing page Recrutement de Commerciaux
 * Formulaire multi-étapes · tracking URL (UTM, gclid, msclkid, fbclid, ltm)
 * · envoi vers Google Sheets (Apps Script) ET vers le CRM Hellolead (préprod)
 * · Téléphone et Code postal obligatoires et formatés
 * · analytics GTM/GA4 conditionnés au consentement avec événement formulaire_lead garanti.
 *
 * Version : 2026-10-06.3-opt-commerciaux
 */

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

const CONFIG = Object.assign({
  googleScriptUrl: 'https://script.google.com/macros/s/AKfycbwrbyCb9-cAmIRPGNvnb-aM-CkhQAerrkfP3_HSw-ewmThxsn4vbZt5daaq2aOnL01a1w/exec',
  leadApiUrl: 'https://mc.hellolead.pro/mon_compte/api/webflow/get_information.php',
  leadApiMode: 'nocors',                            // cors | nocors | off
  leadApiCredentials: 'omit',                       // omit | include
  formId: 'ADW_LP_RECRUTEMENT_COMMERCIAUX',
  crmStrictContract: false,
  debug: false
}, window.UBEPRO_CONFIG || {});

const GOOGLE_SCRIPT_URL = CONFIG.googleScriptUrl;
const LEAD_API_URL = CONFIG.leadApiUrl;
const LEAD_API_MODE = CONFIG.leadApiMode;
const LEAD_API_CREDENTIALS = CONFIG.leadApiCredentials === 'include' ? 'include' : 'omit';
const DEFAULT_FORM_ID = CONFIG.formId || 'ADW_LP_RECRUTEMENT_COMMERCIAUX';
const CRM_STRICT_CONTRACT = CONFIG.crmStrictContract === true;
const DEBUG = CONFIG.debug === true;

// Domaine officiel transmis au CRM et mappé sur page_referrer dans Google Sheets
const domaine = 'ubepro.com';

const TRACKING_STORAGE_KEY = 'ubepro_tracking_v1';
const TRACKING_PAGE_STORAGE_KEY = 'ubepro_tracking_page_url_v1';
const TRACKING_VERSION = '2026-10-06.3-opt-commerciaux';
const SHEET_TIMEOUT_MS = 15000;
const CRM_TIMEOUT_MS = 5000;
const SLOW_NOTICE_MS = 2500;

const MESSAGE_SEND_FAILED = 'Votre demande n\u2019a pas pu \u00eatre envoy\u00e9e. V\u00e9rifiez votre connexion puis r\u00e9essayez.';

const MARKETING_KEYS = new Set(['gclid', 'msclkid', 'fbclid']);
const TRACKING_KEYS = [
  { key: 'source', aliases: ['source', 'utm_source', 'ltm_source'] },
  { key: 'categorie', aliases: ['categorie', 'utm_category', 'ltm_category', 'category'] },
  { key: 'user', aliases: ['user', 'utm_user', 'ltm_user'] },
  { key: 'utm_source', aliases: ['utm_source', 'ltm_source', 'source'] },
  { key: 'utm_medium', aliases: ['utm_medium', 'medium'] },
  { key: 'utm_campaign', aliases: ['utm_campaign', 'campaign'] },
  { key: 'utm_content', aliases: ['utm_content', 'content'] },
  { key: 'utm_term', aliases: ['utm_term', 'term'] },
  { key: 'utm_id', aliases: ['utm_id', 'campaign_id'] },
  { key: 'utm_category', aliases: ['utm_category', 'ltm_category', 'categorie', 'category'] },
  { key: 'utm_user', aliases: ['utm_user', 'ltm_user', 'user'] },
  { key: 'ltm_source', aliases: ['ltm_source', 'utm_source', 'source'] },
  { key: 'ltm_category', aliases: ['ltm_category', 'utm_category', 'categorie', 'category'] },
  { key: 'ltm_typ', aliases: ['ltm_typ', 'utm_typ', 'typ'] },
  { key: 'ltm_user', aliases: ['ltm_user', 'utm_user', 'user'] },
  { key: 'gclid', aliases: ['gclid'] },
  { key: 'msclkid', aliases: ['msclkid'] },
  { key: 'fbclid', aliases: ['fbclid'] }
];

/* ------------------------------------------------------------------ */
/* Gestion du consentement RGPD                                       */
/* ------------------------------------------------------------------ */

const getCookiePreferences = () => {
  if (window.__UBEPRO_COOKIE_PREFERENCES__) return window.__UBEPRO_COOKIE_PREFERENCES__;
  const prefix = 'user_cookie_preferences=';
  for (const part of document.cookie.split(';')) {
    const item = part.trim();
    if (item.startsWith(prefix)) {
      try {
        return JSON.parse(decodeURIComponent(item.slice(prefix.length)));
      } catch (_) {
        return null;
      }
    }
  }
  return null;
};

const analyticsGranted = () => Boolean(getCookiePreferences()?.analytics);
const marketingGranted = () => Boolean(getCookiePreferences()?.marketing);
const trackingGranted = () => analyticsGranted() || marketingGranted();

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

const safeText = (value, maxLength = 500) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.slice(0, maxLength);
};

const normalizePayloadValue = (value) => {
  const sanitized = safeText(value, 500);
  return sanitized.replace(/[<>]/g, '');
};

const debugLog = (...args) => { if (DEBUG) console.debug('[ubepro]', ...args); };

const generateId = () => {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
  } catch (_) { /* contexte non sécurisé */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

/* ------------------------------------------------------------------ */
/* Tracking URL                                                       */
/* ------------------------------------------------------------------ */

const ENTRY_PAGE_URL = typeof window.__UBEPRO_ENTRY_URL__ === 'string'
  ? window.__UBEPRO_ENTRY_URL__
  : window.location.href;

const parseParamsFromString = (searchString) => {
  const params = Object.create(null);
  new URLSearchParams(searchString || '').forEach((value, key) => {
    const cleanKey = String(key).trim().toLowerCase();
    const cleanValue = normalizePayloadValue(value);
    if (cleanKey && cleanValue) params[cleanKey] = cleanValue;
  });
  return params;
};

const getUrlParams = (href = window.location.href) => {
  try {
    const url = new URL(href, window.location.href);
    const hash = url.hash.slice(1);
    const queryIndex = hash.indexOf('?');
    const hashQuery = queryIndex !== -1
      ? hash.slice(queryIndex + 1)
      : (hash.includes('=') && !hash.startsWith('/') ? hash : '');
    return {
      ...parseParamsFromString(hashQuery),
      ...parseParamsFromString(url.search)
    };
  } catch (_) {
    return {};
  }
};

const readStoredParams = () => {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(TRACKING_STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const stored = {};
    TRACKING_KEYS.forEach(({ key }) => {
      if (Object.prototype.hasOwnProperty.call(parsed, key) && typeof parsed[key] === 'string') {
        const value = normalizePayloadValue(parsed[key]);
        if (value) stored[key] = value;
      }
    });
    return stored;
  } catch (_) {
    return {};
  }
};

let trackingMemory = readStoredParams();
let trackingPageUrl = ENTRY_PAGE_URL;
try {
  const storedUrl = window.sessionStorage.getItem(TRACKING_PAGE_STORAGE_KEY);
  if (storedUrl && Object.keys(trackingMemory).length > 0) trackingPageUrl = storedUrl;
} catch (_) { /* Mémoire seule */ }

const storeParams = (params) => {
  trackingMemory = { ...trackingMemory, ...params };
  try {
    if (trackingGranted()) {
      window.sessionStorage.setItem(TRACKING_STORAGE_KEY, JSON.stringify(trackingMemory));
    }
  } catch (_) {}
  return { ...trackingMemory };
};

const captureTrackingParams = (href = window.location.href) => {
  const urlParams = getUrlParams(href);
  const relevant = {};
  TRACKING_KEYS.forEach(({ key, aliases }) => {
    const foundAlias = aliases.find((alias) => urlParams[alias]);
    if (foundAlias) relevant[key] = urlParams[foundAlias];
  });
  if (Object.keys(relevant).length > 0) {
    storeParams(relevant);
    trackingPageUrl = safeText(href, 1000);
    try {
      if (analyticsGranted()) {
        window.sessionStorage.setItem(TRACKING_PAGE_STORAGE_KEY, trackingPageUrl);
      }
    } catch (_) {}
  }
  return { ...trackingMemory };
};

const getTrackingValues = () => {
  captureTrackingParams();
  const values = {};
  TRACKING_KEYS.forEach(({ key }) => {
    const isMarketing = MARKETING_KEYS.has(key);
    const isAllowed = isMarketing ? marketingGranted() : analyticsGranted();
    values[key] = isAllowed ? normalizePayloadValue(trackingMemory[key]) : '';
  });
  if (!values.source && trackingMemory.source) values.source = normalizePayloadValue(trackingMemory.source);
  if (!values.categorie && trackingMemory.categorie) values.categorie = normalizePayloadValue(trackingMemory.categorie);
  return values;
};

// Initialisation immédiate
captureTrackingParams(ENTRY_PAGE_URL);
captureTrackingParams();

window.addEventListener('ubepro:cookie-preferences', () => { captureTrackingParams(); });
document.addEventListener('ubepro:consent-changed', () => { captureTrackingParams(); });

/* ------------------------------------------------------------------ */
/* Téléphone et Code Postal                                           */
/* ------------------------------------------------------------------ */

const normalizePhone = (value) => {
  let text = String(value || '').replace(/[^\d+]/g, '');
  if (/^\+?00/.test(text)) text = `+${text.replace(/^\+?00/, '')}`;
  if (text.startsWith('+33')) text = `0${text.slice(3)}`;
  if (text.startsWith('33') && text.length === 11) text = `0${text.slice(2)}`;
  return text;
};

const validatePhone = (value) => {
  const normalized = normalizePhone(value);
  if (/^0[1-9]\d{8}$/.test(normalized)) return true;
  return /^\+[1-9]\d{7,14}$/.test(normalized);
};

const validatePostal = (value) => /^\d{5}$/.test(String(value || '').replace(/\s+/g, ''));

const formatPhoneInput = (value) => {
  return /^0\d+$/.test(value) ? value.replace(/(\d{2})(?=\d)/g, '$1 ').trim() : value;
};

/* ------------------------------------------------------------------ */
/* Navigation formulaire et interaction DOM                          */
/* ------------------------------------------------------------------ */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('study-form');
  if (!form) return;

  const steps = [...form.querySelectorAll('.form-step')];
  const nextButton = form.querySelector('.form-next');
  const backButton = form.querySelector('.form-back');
  const progress = form.querySelector('.form-progress');
  const error = form.querySelector('.form-error');
  const successBox = form.querySelector('.form-success');
  const honeypotField = form.querySelector('input[name="website"]');
  const phoneField = form.querySelector('input[name="telephone"]');
  const postalField = form.querySelector('input[name="code_postal"]');

  // Menu mobile
  const navToggle = document.querySelector('.menu-toggle');
  const mobileNav = document.getElementById('mobile-nav');
  if (navToggle && mobileNav) {
    navToggle.addEventListener('click', () => {
      const isExpanded = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!isExpanded));
      mobileNav.hidden = isExpanded;
    });
    mobileNav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        navToggle.setAttribute('aria-expanded', 'false');
        mobileNav.hidden = true;
      });
    });
  }

  // Formatage téléphone
  phoneField?.addEventListener('input', () => {
    const value = normalizePhone(phoneField.value);
    const formatted = formatPhoneInput(value);
    if (phoneField.value !== formatted) phoneField.value = formatted;
  });

  // Code postal : 5 chiffres
  postalField?.addEventListener('input', () => {
    const value = String(postalField.value || '').replace(/\D/g, '');
    postalField.value = value.slice(0, 5);
  });

  /* ---- Navigation multi-étapes ---- */
  let currentStep = 0;
  const showStep = (index) => {
    currentStep = index;
    steps.forEach((step, stepIndex) => {
      step.hidden = stepIndex !== index;
      step.classList.toggle('is-active', stepIndex === index);
    });
    if (progress) {
      progress.innerHTML = steps.map((_, idx) => (idx <= currentStep ? '<i></i>' : '<b></b>')).join('');
    }
  };

  const validateStep1 = () => {
    const required = [...steps[0].querySelectorAll('[required]')];
    const invalidField = required.find((field) => !field.checkValidity());
    if (invalidField) {
      error.textContent = 'Sélectionnez un profil commercial pour continuer.';
      error.hidden = false;
      invalidField.reportValidity?.();
      invalidField.focus();
      return false;
    }
    error.hidden = true;
    return true;
  };

  const validateStep2 = () => {
    const required = [...steps[1].querySelectorAll('[required]')];
    const invalidField = required.find((field) => !field.checkValidity());
    if (invalidField) {
      error.textContent = 'Vérifiez les champs obligatoires avant d\'envoyer.';
      error.hidden = false;
      invalidField.reportValidity?.();
      invalidField.focus();
      return false;
    }

    if (!phoneField || !phoneField.value.trim()) {
      error.textContent = 'Le numéro de téléphone est obligatoire.';
      error.hidden = false;
      phoneField?.focus();
      return false;
    }
    if (!validatePhone(phoneField.value)) {
      error.textContent = 'Saisissez un numéro de téléphone valide (ex. 06 12 34 56 78).';
      error.hidden = false;
      phoneField.focus();
      return false;
    }

    if (!postalField || !postalField.value.trim()) {
      error.textContent = 'Le code postal est obligatoire.';
      error.hidden = false;
      postalField?.focus();
      return false;
    }
    const cleanPostal = String(postalField.value).replace(/\s+/g, '');
    if (!validatePostal(cleanPostal)) {
      error.textContent = 'Le code postal doit comporter exactement 5 chiffres (ex. 75008).';
      error.hidden = false;
      postalField.focus();
      return false;
    }

    error.hidden = true;
    return true;
  };

  nextButton?.addEventListener('click', () => {
    if (validateStep1()) showStep(1);
  });
  backButton?.addEventListener('click', () => {
    error.hidden = true;
    showStep(0);
  });

  const showFormSuccess = () => {
    steps.forEach((step) => { step.hidden = true; });
    if (progress) progress.style.display = 'none';
    if (successBox) successBox.hidden = false;
    const privacyNote = form.closest('.form-wrap')?.querySelector('.privacy-note');
    if (privacyNote) {
      privacyNote.textContent = 'Merci pour votre demande. Un consultant senior étudie votre recherche et vous rappelle sous 24h ouvrées.';
    }
    try {
      successBox?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (_) {}
  };

  const resetLink = document.getElementById('form-reset-link');
  resetLink?.addEventListener('click', (e) => {
    e.preventDefault();
    form.reset();
    if (successBox) successBox.hidden = true;
    if (progress) progress.style.display = '';
    const privacyNote = form.closest('.form-wrap')?.querySelector('.privacy-note');
    if (privacyNote) {
      privacyNote.textContent = 'Vos données ne servent qu’à traiter votre demande de rappel — jamais partagées sans votre accord.';
    }
    showStep(0);
  });

  /* ------------------------------------------------------------------ */
  /* Construction des payloads                                          */
  /* ------------------------------------------------------------------ */

  const buildPayloads = () => {
    const tracking = getTrackingValues();
    const formData = Object.fromEntries(new FormData(form));
    const formId = normalizePayloadValue(formData.form_id || DEFAULT_FORM_ID) || DEFAULT_FORM_ID;

    const coordonnees = {
      nom: normalizePayloadValue(formData.nom),
      prenom: normalizePayloadValue(formData.prenom),
      mail: normalizePayloadValue(formData.mail || formData.email).toLowerCase(),
      telephone: normalizePhone(formData.telephone),
      societe: normalizePayloadValue(formData.societe),
      code_postal: normalizePayloadValue(formData.code_postal).replace(/\s+/g, ''),
      civilite: normalizePayloadValue(formData.civilite),
      ville: normalizePayloadValue(formData.ville)
    };

    const questionnaires = {
      question_1: 'Profil commercial recherché',
      reponse_1: normalizePayloadValue(formData.solution),
      question_2: 'Secteur d’activité',
      reponse_2: normalizePayloadValue(formData.site),
      question_3: 'Priorité de recrutement',
      reponse_3: normalizePayloadValue(formData.enjeu || 'Recrutement commercial immédiat')
    };

    const sheetData = {
      ...coordonnees,
      site: normalizePayloadValue(formData.site),
      solution: normalizePayloadValue(formData.solution),
      enjeu: normalizePayloadValue(formData.enjeu || 'Recrutement commercial immédiat'),
      ...questionnaires,
      ...tracking,
      page_referrer: domaine
    };

    const crmData = {
      ...coordonnees,
      domaine: domaine,
      source: tracking.source,
      categorie: tracking.categorie,
      user: tracking.user,
      gclid: tracking.gclid,
      msclkid: tracking.msclkid,
      ...questionnaires
    };

    return { formData, tracking, formId, coordonnees, questionnaires, sheetData, crmData };
  };

  /* ------------------------------------------------------------------ */
  /* Envois : Google Sheet + CRM Hellolead                             */
  /* ------------------------------------------------------------------ */

  const sendToSheet = async (sheetData, formId, leadId) => {
    const body = new URLSearchParams();
    Object.entries(sheetData).forEach(([key, value]) => body.set(key, value));
    body.set('form_id', formId);
    body.set('id_lead', leadId);
    body.set('page_referrer', domaine);
    if (analyticsGranted()) {
      body.set('page_url', safeText(trackingPageUrl, 1000));
      body.set('user_agent', safeText(navigator.userAgent, 300));
      body.set('langue', safeText(navigator.language || '', 20));
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), SHEET_TIMEOUT_MS) : null;
    try {
      const response = await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body,
        keepalive: true,
        signal: controller ? controller.signal : undefined
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
      if (!parsed || parsed.status !== 'ok') {
        throw new Error((parsed && parsed.message) || 'Réponse inattendue du script Google.');
      }
      return { target: 'sheet', state: 'ok', response: parsed };
    } catch (sendError) {
      console.error('[ubepro] Google Sheet en échec :', sendError);
      return { target: 'sheet', state: 'error', error: sendError };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const sendToCrm = async (crmData, formId, leadId) => {
    if (LEAD_API_MODE === 'off' || !LEAD_API_URL) return { target: 'crm', state: 'off' };

    const body = JSON.stringify({ payload: { formId, id: leadId, data: crmData } });

    if (LEAD_API_MODE === 'cors') {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), CRM_TIMEOUT_MS) : null;
      try {
        const response = await fetch(LEAD_API_URL, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json; charset=UTF-8' },
          body,
          credentials: LEAD_API_CREDENTIALS,
          signal: controller ? controller.signal : undefined
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        let parsed = null;
        try { parsed = JSON.parse(await response.text()); } catch (_) { parsed = null; }
        if (!parsed || parsed.status !== 'ok') {
          throw new Error((parsed && parsed.message) || 'Réponse inattendue du CRM.');
        }
        return { target: 'crm', state: 'ok', response: parsed };
      } catch (crmError) {
        console.error('[ubepro] CRM en échec (mode cors) :', crmError);
        return { target: 'crm', state: 'error', error: crmError };
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }

    // Mode nocors (défaut) : sendBeacon puis fetch no-cors
    try {
      if (typeof navigator.sendBeacon === 'function'
          && navigator.sendBeacon(LEAD_API_URL, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) {
        return { target: 'crm', state: 'unverified', via: 'beacon' };
      }
    } catch (beaconError) {
      console.warn('[ubepro] sendBeacon CRM échoué, repli fetch :', beaconError);
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), CRM_TIMEOUT_MS) : null;
    try {
      await fetch(LEAD_API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body,
        keepalive: true,
        credentials: LEAD_API_CREDENTIALS,
        signal: controller ? controller.signal : undefined
      });
      return { target: 'crm', state: 'unverified', via: 'fetch' };
    } catch (crmError) {
      console.error('[ubepro] CRM : fetch no-cors en échec :', crmError);
      return { target: 'crm', state: 'error', error: crmError };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Diagnostic console                                                 */
  /* ------------------------------------------------------------------ */

  window.ubeproLead = {
    version: TRACKING_VERSION,
    config: {
      googleScriptUrl: GOOGLE_SCRIPT_URL,
      leadApiUrl: LEAD_API_URL,
      leadApiMode: LEAD_API_MODE,
      formId: DEFAULT_FORM_ID,
      domaine: domaine
    },
    preview: () => {
      const { crmData, sheetData, formId } = buildPayloads();
      return {
        crm: { payload: { formId, id: '(généré à la soumission)', data: crmData } },
        sheet: sheetData
      };
    },
    lastResults: null,
    last: () => window.ubeproLead.lastResults,
    tracking: getTrackingValues
  };

  /* ------------------------------------------------------------------ */
  /* Soumission                                                         */
  /* ------------------------------------------------------------------ */

  let isSubmitting = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    if (currentStep === 0) {
      if (validateStep1()) showStep(1);
      return;
    }
    if (!validateStep2()) return;

    if (honeypotField && honeypotField.value.trim() !== '') {
      debugLog('Honeypot rempli, envoi ignoré.');
      showFormSuccess();
      return;
    }

    isSubmitting = true;
    error.hidden = true;
    const submitButton = form.querySelector('button[type="submit"]');
    const originalLabel = submitButton ? submitButton.innerHTML : '';
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.setAttribute('aria-busy', 'true');
      submitButton.textContent = 'Envoi en cours…';
    }

    try {
      const { sheetData, crmData, formId } = buildPayloads();
      const leadId = generateId();

      debugLog('Google Sheet payload :', sheetData);
      debugLog('CRM payload :', { payload: { formId, id: leadId, data: crmData } });

      const results = [];
      let confirmed = false;
      const record = (result) => {
        results.push(result);
        window.ubeproLead.lastResults = [...results];
        debugLog('Résultat :', result);
        if (!confirmed && (result.state === 'ok' || result.state === 'unverified')) {
          confirmed = true;
          showFormSuccess();
        }
      };

      const slowNotice = setTimeout(() => {
        if (!confirmed && submitButton) submitButton.textContent = 'Enregistrement en cours…';
      }, SLOW_NOTICE_MS);

      const both = Promise.all([
        sendToSheet(sheetData, formId, leadId).then(record),
        sendToCrm(crmData, formId, leadId).then(record)
      ]).then(() => true);

      await Promise.race([
        both,
        new Promise((resolve) => setTimeout(() => resolve(false), SLOW_NOTICE_MS))
      ]);
      await both;
      clearTimeout(slowNotice);

      if (!confirmed) {
        error.textContent = MESSAGE_SEND_FAILED;
        error.hidden = false;
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.removeAttribute('aria-busy');
          submitButton.innerHTML = originalLabel;
        }
        return;
      }

      /* ---- Déclenchement SYSTÉMATIQUE conversion GTM ---- */
      try {
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'formulaire_lead' });

        if (analyticsGranted()) {
          window.dataLayer.push({
            event: 'generate_lead',
            form_id: formId,
            commercial_profile: sheetData.solution,
            commercial_sector: sheetData.site
          });
          if (typeof window.gtag === 'function') {
            window.gtag('event', 'generate_lead', { form_id: formId });
          }
        }
      } catch (gtmErr) {
        console.warn('[ubepro] Échec push GTM :', gtmErr);
      }

      if (submitButton) {
        submitButton.removeAttribute('aria-busy');
        submitButton.innerHTML = originalLabel;
      }
    } catch (sendErr) {
      console.error('[ubepro] Échec envoi lead :', sendErr);
      error.textContent = MESSAGE_SEND_FAILED;
      error.hidden = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute('aria-busy');
        submitButton.innerHTML = originalLabel;
      }
    } finally {
      isSubmitting = false;
    }
  });

  /* ---- Animations d'apparition ---- */
  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.style.animationPlayState = 'running';
        observer.unobserve(entry.target);
      }
    }), { threshold: .12 });
    revealItems.forEach((item) => {
      item.style.animationPlayState = 'paused';
      observer.observe(item);
    });
  }
});
