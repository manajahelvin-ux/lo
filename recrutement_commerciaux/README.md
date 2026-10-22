# UBEPRO — Landing Page Recrutement de Commerciaux (v4 - Standard Groupe)

Landing page d'acquisition B2B de talents commerciaux entièrement alignée sur le socle technique standardisé du groupe (**AGV/AMR**, **Formation**, **Citroën VU**, **Véhicule Pro**, **Recrutement Cadres & Dirigeants**) :
- **Formulaire placé en haut à droite sur PC** (dans la section Hero).
- **Formulaire affiché en premier tout en haut sur Mobile & Tablette** (`order: 1` sans défilement initial grâce à `grid-template-areas: "form" "copy" "photo"`).
- **Champs Prénom (`prenom`) et Nom (`nom`) dissociés** avec autocomplétion.
- **Champs Téléphone (`telephone`) et Code postal (`code_postal`) obligatoires** avec masquage de saisie et validation stricte (5 chiffres).
- **Google Tag Manager** (`GTM-53SH7D7F`) et **Google Consent Mode v2**.
- **Plateforme de gestion du consentement (CMP)** conforme RGPD avec rétention 180 jours.
- **Événement GTM `formulaire_lead` garanti** dès la confirmation backend du lead.
- **API CRM configurée sur la Préproduction** pour tests locaux avec ajout du paramètre `domaine: 'ubepro.com'` et mode `nocors`.
- **Référencement SEO complet** : Meta Open Graph, Twitter Cards, balise canonique, données structurées Schema.org JSON-LD multi-entités (`EmploymentAgency`, `WebPage`, `Service`, `FAQPage`).
- **Standard GEO (Generative Engine Optimization)** : fichier `llms.txt` structuré pour moteurs IA et directives de crawl explicites dans `robots.txt` (GPTBot, ClaudeBot, PerplexityBot, Google-Extended).

---

## Structure des fichiers

```text
LP_RECRUTEMENT_COMMERCIAUX/
├── index.html              ← LP (Hero avec formulaire en haut à droite / 1er sur mobile, SEO, JSON-LD)
├── style.css               ← Styles responsive complets (PC, tablette, mobile) + CMP cookies
├── script.js               ← Double envoi (Sheets + CRM préprod), validation tel/code postal, GTM
├── cookie-consent.js       ← CMP UbePro (Consent Mode v2, rétention 180 jours, événements resync)
├── llms.txt                ← Standard GEO pour moteurs LLM (Perplexity, ChatGPT, Claude, Gemini)
├── robots.txt              ← Directives de crawl SEO + autorisations explicites des bots IA + sitemap
├── sitemap.xml             ← Plan de site XML avec géolocalisation et métadonnées images
├── README.md               ← Documentation technique et fonctionnelle
└── img/                    ← Visuels responsives WebP et favicon SVG
```

---

## 1. Nouveaux champs et normalisation des coordonnées

À l'Étape 2 du formulaire :
* **Prénom (`prenom`) et Nom (`nom`) :** Deux champs distincts dans une ligne (`.field-row`), avec autocomplétion HTML5 (`given-name`, `family-name`).
* **Téléphone direct (`telephone`) :** Saisie assistée avec espacement automatique (`06 12 34 56 78`) et validation stricte (formats fixes, mobiles français et indicatif international).
* **Code postal (`code_postal`) :** Saisie restreinte aux chiffres (`inputmode="numeric"`), 5 chiffres obligatoires.

Ces données sont automatiquement nettoyées et transmises dans le contrat CRM (`data.nom`, `data.prenom`, `data.telephone`, `data.code_postal`) et dans les colonnes correspondantes de Google Sheets.

---

## 2. Ergonomie Responsive (Mobile-First & Desktop)

| Écran | Comportement |
|---|---|
| **PC (> 860px)** | Grille 2 colonnes dans le Hero : argumentaire à gauche, **formulaire en haut à droite** (`grid-template-areas: "copy form" "photo form"`). |
| **Tablette & Mobile (<= 860px)** | Colonne unique fluide, **le formulaire passe en tête de page en premier (`grid-template-areas: "form" "copy" "photo"`)** pour une conversion immédiate. Les textes descriptifs sont affichés en dessous. |
| **Mobile compact (< 640px)** | Entrées adaptées (pas de zoom iOS Safari), boutons pleine largeur, accordéons tactiles. |

---

## 3. Configuration CRM (Préproduction active)

L'endpoint CRM est configuré sur l'environnement de **préproduction** pour vos tests locaux :
* **Endpoint préproduction :** `https://mc.helloleadpreprod.fr/mon_compte/api/webflow/get_information.php`
* **Identifiant formulaire (`formId`) :** `ADW_LP_RECRUTEMENT_COMMERCIAUX`
* **Domaine transmis :** `ubepro.com`
* **Mode d'envoi :** `nocors` (tentative `sendBeacon` puis repli `fetch no-cors`)

### Bascule en Production (quand les tests locaux sont validés)
Insérez simplement ce bloc dans `index.html` juste avant `<script src="script.js...` :
```html
<script>
  window.UBEPRO_CONFIG = {
    leadApiUrl: 'https://mc.hellolead.pro/mon_compte/api/webflow/get_information.php'
  };
</script>
```

---

## 4. Tracking Google Tag Manager & DataLayer

* **Tag principal (`<head>`) :** `https://www.googletagmanager.com/gtm.js?id=GTM-53SH7D7F` (après Consent Mode v2).
* **Tag noscript (`<body>`) :** `https://www.googletagmanager.com/ns.html?id=GTM-53SH7D7F`.
* **Événement `formulaire_lead` :** Déclenché systématiquement dès confirmation backend du lead :
  ```javascript
  dataLayer.push({ event: 'formulaire_lead' });
  ```
* **Événement `generate_lead` :** Déclenché avec métadonnées (`commercial_profile`, `commercial_sector`) uniquement si le consentement analytics est accordé.

---

## 5. Diagnostic & Commandes Console

* **Inspecter les valeurs de tracking et statut consentement :**
  ```javascript
  console.table(window.ubeproLead.tracking());
  ```
* **Prévisualiser le payload complet qui sera envoyé :**
  ```javascript
  console.log(window.ubeproLead.preview());
  ```
