# Gestionnaire Real Estate — Hub admin interne

> Spec de référence. À lire en contexte avant toute implémentation ou évolution.
> Rôle : point d'entrée interne pour naviguer entre l'API et l'Outil, et héberger des tableaux de bord admin.

---

## 1. Positionnement dans le monorepo

```
api-real-estate/                   (racine)
├── api-real-estate/               Backend FastAPI + PostgreSQL (produit 1)
├── plateforme-real-estate/        Outil recherche public HTML/JS (produit 2)
└── gestionnaire-real-estate/      Hub admin interne (produit 3 — CE PROJET)
```

**Règles de frontières :**
- Le Hub consomme **exclusivement** l'API `api-real-estate` via HTTP (jamais d'accès direct DB).
- Le Hub **n'est pas exposé publiquement** : usage interne uniquement, protégé par `X-Admin-Token` déjà en place côté API.
- Aucune dépendance build (pas de Node/Webpack/Vite). Vanille HTML/CSS/JS + libs via CDN.
- Le Hub peut lier vers l'Outil public (`plateforme-real-estate`) mais ne doit jamais le remplacer ni dupliquer sa logique.

---

## 2. Stack & déploiement

| Élément | Choix |
|---|---|
| Front | HTML/CSS/JS vanille |
| Cartographie | Leaflet 1.9 (CDN) + tuiles OpenStreetMap (gratuit, pas de clé) |
| Clustering | Leaflet.markercluster (CDN) |
| Serveur | **nginx:alpine** (static files) |
| Conteneurisation | Dockerfile + `docker-compose.yml` dédié |
| Port par défaut | `8080` (hôte) → `80` (conteneur) |
| Intégration | Compose autonome, **peut aussi être mergé** dans le compose principal `api-real-estate/docker-compose.yml` |

### Dockerfile type
```Dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### `nginx.conf` — points clés
- Activer `gzip` sur HTML/CSS/JS.
- Cache-Control pour `/assets/*` (max-age=3600) mais **pas** pour `index.html`.
- Header `X-Frame-Options: DENY` (ne doit jamais être embarqué en iframe).
- Optionnel : ajouter une `auth_basic` simple si le Hub finit sur un serveur public — en plus du `X-Admin-Token` qui protège déjà l'API.

### `docker-compose.yml` autonome
```yaml
services:
  gestionnaire:
    build: .
    container_name: gestionnaire-real-estate
    ports:
      - "8080:80"
    restart: unless-stopped
```

---

## 3. Arborescence cible

```
gestionnaire-real-estate/
├── SPECS.md                        Ce document
├── README.md                       Quickstart (docker compose up, accès, config)
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
├── index.html                      Page Hub (landing)
├── admin/
│   └── agencies-table.html         Outil 1 V1 : tableau agences par CP (V2 : agencies-map.html)
├── assets/
│   ├── style.css                   Style global (partagé Hub + outils)
│   ├── hub.js                      Config globale (apiUrl, token, ping)
│   ├── agencies-table.js           Logique tableau grouping CP + filtres (V2 : agencies-map.js)
│   └── common.js                   Helpers : fetchWithAuth, toast, storage
└── .gitignore
```

---

## 4. Page Hub (`index.html`)

### Fonctionnalités
1. **Barre de configuration (header)**
   - Input `API URL` (défaut `http://localhost:8000`)
   - Input password `X-Admin-Token`
   - Input URL `Outil public` (défaut pointant vers `plateforme-real-estate`)
   - Persistance **localStorage** uniquement. Jamais en dur.
   - Indicateur santé API (pastille verte/rouge) basé sur un ping `GET /` ou `GET /docs`.

2. **Zone de navigation — 3 tuiles**
   - **API** → ouvre `{apiUrl}/docs` (Swagger UI) dans un nouvel onglet.
   - **Outil recherche** → ouvre l'URL configurée dans un nouvel onglet.
   - **Admin › Carte agences** → navigue vers `admin/agencies-map.html`.

3. **Zone stats live**
   - Appelle `GET /admin/agencies/stats` avec le token.
   - Affiche : total agences, par statut (pending / to_scrape / scraped / skip / closed), dernière mise à jour.
   - Rafraîchissement toutes les 60s si onglet actif.

### Règles UX
- Si token absent → tuiles Admin désactivées + bandeau "Configurer le token admin".
- Si API injoignable → pastille rouge + message explicite sur chaque tuile dépendante.

---

## 5. Outil 1 — Tableau par CP (V1) · Carte Leaflet (V2+)

> **V1** livre uniquement la vue tableau groupée par code postal. La carte Leaflet décrite plus bas est repoussée en V2+ : objectif V1 = MVP read-only rapide, la carte est un enrichissement.

### V1 — Tableau `admin/agencies-table.html`

- **Source** : `GET /admin/agencies?limit=5000` (+ filtres statut / dept / source)
- **Regroupement** : par `zipcode` croissant. Fallback `"inconnu"` pour les agences sans CP
- **Chaque groupe** : en-tête pliable `CP XXXXX — Ville — N agences` avec badges compteurs par statut
- **Colonnes** : Nom · Ville · Adresse · Source · Statut (badge coloré pending/to_scrape/scraped/skip/closed) · Téléphone · Site web · Actions
- **Filtres** (barre haute) : statut multi-check, département (`zipcode[:2]` distincts), source, recherche texte (debounce 200ms)
- **Stats footer** : `Affichées : X / Y en base  ·  Z codes postaux couverts  ·  N sans GPS (à géocoder en V2)`
- **Export CSV** : bouton appelant `GET /admin/agencies/export` avec filtres appliqués
- **Aucune dépendance carto en V1** — HTML/CSS + vanille JS uniquement

### V2+ — Carte Leaflet `admin/agencies-map.html`

Enrichissement du tableau par une vue carte exploitant les `lat/lng` déjà présents en base. Les spécifications carto qui suivent décrivent la V2.

### Données (V2 — carte)
Endpoint cible (à implémenter côté API, voir §7) :
```
GET /admin/agencies/geojson?has_coords=true&status=...&dept=...&source=...
Headers: X-Admin-Token: <token>
Response: FeatureCollection GeoJSON
```
Fallback acceptable si endpoint `/geojson` pas encore dispo :
```
GET /admin/agencies?has_coords=true&limit=5000
```
puis conversion client.

### Carte
- Leaflet + tuiles OSM (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`)
- Zoom initial : France centrée (`[46.6, 2.5]`, zoom 6)
- Clustering automatique via `Leaflet.markercluster`
- Bouton "Recentrer France" / "Recentrer sur la sélection"

### Markers
Couleurs par statut :
| Statut | Couleur |
|---|---|
| `pending` | gris `#9ca3af` |
| `to_scrape` | bleu `#3b82f6` |
| `scraped` | vert `#10b981` |
| `skip` | rouge `#ef4444` |
| `closed` | noir `#1f2937` |

Implémentation : `L.divIcon` avec classe CSS par statut (évite images).

### Popup
Chaque marker affiche au clic :
- **Nom** (gras)
- Adresse complète + ville + code postal
- SIRET + source
- Téléphone (si dispo) → `tel:` link
- Site web → lien `target="_blank" rel="noopener"`
- Statut actuel (badge coloré)
- Bouton "Voir fiche API" → ouvre `{apiUrl}/docs#/admin-agencies/read_agency_admin_agencies__agency_id__get` ou équivalent
- (V2) Bouton "Changer statut" → modale de patch via `PATCH /admin/agencies/{id}`

### Panneau filtres (sidebar gauche, rétractable)
- **Statut** : checkboxes multi-select (tous cochés par défaut)
- **Département** : select alimenté dynamiquement à partir des `zipcode[:2]` distincts dans la donnée chargée
- **Source** : checkboxes (`cci`, `sirene`, `fnaim`, `snpi`, ...)
- **Recherche texte** : filtre client sur nom/ville/adresse (debounce 200ms)
- Bouton **"Appliquer"** (ou live) + **"Réinitialiser"**

Les filtres **statut / dept / source** sont passés à l'API (refetch).
La **recherche texte** est purement client-side sur le dataset déjà chargé.

### Stats live (footer carte)
```
Affichées : 1234  |  Total en base : 5678  |  Sans GPS : 123
```

### Actions
- **Exporter CSV de la sélection** → appel `GET /admin/agencies/export?<mêmes filtres>` → téléchargement.
- **Recharger** → refetch GeoJSON.

---

## 6. Modèle de données (rappel)

La table `DiscoveredAgency` (`api-real-estate/models.py`) contient déjà :
```
id, name, address, city, zipcode, lat, lng, phone, website,
siret (unique), place_id, source, status, scraper_class, notes,
discovered_at, reviewed_at
```
**Aucune migration Alembic nécessaire** pour V1 du Hub.

Statuts valides : `pending | to_scrape | skip | scraped | closed` (voir `admin_routes.py` → `VALID_STATUSES`).

---

## 7. Impact backend (`api-real-estate/admin_routes.py`)

### 7.1 Étendre `GET /admin/agencies`
Nouveaux query params :
- `has_coords: bool = False` → ajoute `lat IS NOT NULL AND lng IS NOT NULL`
- `dept: str | None = None` → ajoute `zipcode LIKE f'{dept}%'`
- Relever `limit` max à **5000** (avec clamp serveur).

### 7.2 Nouvel endpoint `GET /admin/agencies/geojson` (V2)
Retourne un FeatureCollection GeoJSON prêt à consommer :
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {"type": "Point", "coordinates": [lng, lat]},
      "properties": {
        "id": 123, "name": "...", "address": "...",
        "city": "...", "zipcode": "...", "siret": "...",
        "source": "...", "status": "...", "phone": "...",
        "website": "..."
      }
    }
  ]
}
```
Supporte les mêmes filtres que `/admin/agencies` + force `has_coords=true`.

### 7.3 CORS
Autoriser l'origine du conteneur Hub (ex: `http://localhost:8080`) en dev/prod. Garder la protection par `X-Admin-Token` (le CORS n'est pas de l'auth).

---

## 8. Sécurité

- **Token admin** : uniquement dans `localStorage`. Jamais committé, jamais dans une URL, jamais dans un log.
- **Hub non public** : README explicite + `X-Frame-Options: DENY` + `Referrer-Policy: no-referrer`.
- Si déploiement sur serveur public : ajouter `auth_basic` nginx ou un reverse proxy avec auth (OAuth proxy, Tailscale, etc.) — **le token API ne suffit pas** à protéger l'interface elle-même contre un indexage/scan.
- Pas de tracking, pas d'analytics, pas de CDN tiers en dehors des libs carto.
- CSP recommandée :
  ```
  default-src 'self';
  img-src 'self' data: https://*.tile.openstreetmap.org;
  script-src 'self' https://unpkg.com;
  style-src 'self' 'unsafe-inline' https://unpkg.com;
  connect-src 'self' <apiUrl configuré>;
  ```

---

## 9. Roadmap

### V1.0 Draft (15 avril 2026) — MVP read-only
- [ ] Squelette dossier + Docker + nginx + README
- [ ] Page Hub avec config token + 3 tuiles + ping santé
- [ ] Backend : extension `/admin/agencies` (params `has_coords`, `dept`, limit 5000)
- [ ] Vue tableau agences groupées par CP (pas de Leaflet)
- [ ] Filtres statut / dept / source / recherche texte
- [ ] Stats live Hub + footer tableau
- [ ] Export CSV filtré

### V1 (fin avril 2026)
- [ ] Édition inline du statut depuis la popup (`PATCH /admin/agencies/{id}`)
- [ ] Modale "fiche agence" détaillée
- [ ] Refresh auto toutes les 5 min avec diff visuel

### V2 (mai 2026)
- [ ] Backend : endpoint `/admin/agencies/geojson` (FeatureCollection)
- [ ] Carte Leaflet + clustering + markers colorés + popups (upgrade du tableau)
- [ ] Heatmap densité agences (Leaflet.heat)
- [ ] Géocodage auto des agences sans coords via `api.adresse.data.gouv.fr`
- [ ] Second outil admin : dashboard pipeline scraping (dernières runs, erreurs, file d'attente)
- [ ] Troisième outil admin : explorateur `canonical_ads` cross-sources

### V3
- [ ] Auth côté Hub (OAuth interne ou Basic Auth nginx)
- [ ] Multi-utilisateurs avec rôles
- [ ] Logs d'audit des actions admin

---

## 10. Risques

| Risque | Mitigation |
|---|---|
| Fuite du `X-Admin-Token` | Jamais en dur, uniquement localStorage, README explicite |
| Hub exposé publiquement par erreur | `X-Frame-Options: DENY`, README warning, préférer déploiement derrière VPN/reverse proxy auth |
| Trop d'agences → carte lente | Clustering obligatoire, limit API 5000, filtres serveur |
| Leaflet CDN down | Fallback : héberger les libs en local dans `assets/vendor/` si besoin |
| Dataset sans lat/lng massif | Stats "sans GPS" visibles + V2 géocodage auto |

---

## 11. Conventions de code

- Pas de framework front. `hub.js` et `agencies-map.js` exportent via `window.*` si besoin de partage.
- Fonction commune `fetchAdmin(path, opts)` dans `common.js` qui injecte automatiquement `X-Admin-Token`.
- Toute erreur réseau → toast visuel non bloquant.
- Pas de secrets committés. `.gitignore` inclut `*.local.*`.
- Messages utilisateur en français (cohérence avec l'Outil).

---

## 12. Projet Asana associé

Nouveau projet Asana **"Gestionnaire Real Estate (Hub)"** (GID à renseigner après création) avec les sections :
- `V1.0 Draft — Hub & Carte agences (15 avril 2026)`
- `V1 — Hub complet (Fin avril 2026)`
- `V2 — Outils admin enrichis (Mai 2026)`
- `V3 — Hub sécurisé & multi-user`
- `Risques & Sécurité`

Toute évolution de cette spec doit être répercutée sur ce projet Asana après confirmation utilisateur (règle du skill `product-designer`).
