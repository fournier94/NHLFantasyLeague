# Ligue de Mousse

**Démo en ligne VERSION MOBILE SEULEMENT (la version desktop n'est pas présentement prise en compte lors du développement) → [liguedemousse.com](https://liguedemousse.com)** (consultable sans compte).

Application web de gestion de ligue de hockey fantasy keeper, développée pour une ligue privée de 12 équipes. Remplace l'ancien setup Pool Expert avec un système de pointage cumulatif, un marché d'échanges, un plafond salarial, et un suivi en direct des matchs de la LNH.

Ce projet a débuté en début septembre 2026 et est présentement en "early access" pour la version mobile alors que la version desktop n'est présentement pas prise en compte puisque les utilisateurs y accèdent exclusivement via une application PWA téléchargeable à partir du menu hamburger.

[English version →](README.en.md)

---

## À propos

Ligue de Mousse est une application full-stack construite pour une ligue de hockey fantasy privée. La ligue existe depuis plusieurs années, mais utilisait jusqu'ici une plateforme générique (Pool Expert) qui ne respectait pas ses règles maison. Cette application implémente les règles spécifiques de la ligue dans un système dédié : historique de statut append-only pour le calcul du pointage, plafond salarial avec rétention, gestion des choix de repêchage limitée aux deux prochaines années, et marché d'échanges avec support des contre-offres.

## Fonctionnalités

- **Pointage cumulatif** sur la saison régulière (pas de matchups hebdomadaires) — chaque équipe accumule les points de ses joueurs actifs à travers toute la saison
- **Alignement flexible** — 12 attaquants + 6 défenseurs + 1 gardien actifs, 7 joueurs sur le banc, 3 prospects, avec un historique append-only de tous les changements
- **Marché d'échanges** — annonces publiques, offres directes, contre-offres, avec support des choix de repêchage
- **Plafond salarial** — suivi de la masse salariale, projection sur 5 ans, contrats protégés (rétention salariale)
- **Repêchage** — gestion des choix 2027 et 2028, loterie, transferts
- **Game Day** — scores live, sommaires de match, suivi des joueurs fantasy dans chaque match
- **Statistiques** — meilleurs pointeurs, classement LNH, blessures
- **Panneau commissaire** — gestion des rosters, échanges, contrats manuels, sauvegardes DB, audit trail

## Application mobile (PWA)

L'application est une **Progressive Web App** installable sur mobile :

- **Android / Chrome / Edge** — ouvrir le menu hamburger et cliquer sur « Installer l'application ».
- **iOS Safari** — ouvrir le menu hamburger, lire les instructions affichées, puis utiliser le bouton **Partager** de Safari et choisir « Sur l'écran d'accueil ».
- Une fois installée, l'application se lance en plein écran comme une app native, avec support hors-ligne des ressources statiques.

## Stack technique

**Backend** — ASP.NET Core 8 · Entity Framework Core 8 · PostgreSQL 18 · Identity (cookie auth) · Data Protection persisté en DB
**Frontend** — React 19 · TypeScript · Vite · Tailwind CSS 4 · shadcn/ui · TanStack Virtual · PWA (service worker, install prompt)
**Déploiement** — Docker Compose sur OVH VPS (Ubuntu 24.04) · Nginx en reverse proxy · auto-hébergé

## Architecture — points techniques notables

- **Scoring par historique append-only** — la table `RosterStatusHistory` enregistre chaque changement de statut avec une date effective. Pour créditer un match à une équipe, le moteur de calcul résout l'état du joueur au moment du coup d'envoi. Un joueur échangé en cours de saison crédite donc les deux équipes, chacune pour la portion de matchs où il était actif chez elle.

- **Rate limiting sur l'API NHL** — un `NhlApiRateLimiter` singleton partagé entre tous les jobs planifiés, avec un `AsyncLocal` flag qui laisse passer les requêtes initiées par un utilisateur tout en étranglent les jobs de fond. Le handler HTTP de rate limiting est innermost pour qu'une écriture DB lente (via le handler de logging) ne puisse pas bloquer le sémaphore.

- **Cache de réponse in-memory** — les endpoints de classement, roster et leaderboards sont cachés pendant 30 secondes. Les mutations (échange, changement de statut, recompute) invalident explicitement les préfixes concernés.

- **Job scheduler à priorités** — les jobs rares (hebdomadaire, quotidien) ne peuvent pas être interrompus par un job fréquent et ne peuvent pas être sautés si un autre job roule. Garde-fou `CancellationToken.None` pour les jobs critiques.

- **Intégrations externes** — NHL API (stats + game logs + schedule), ESPN (blessures), CapFreeze (contrats), avec des handlers d'erreur qui loggent dans `SystemEventLogs` pour l'admin.

- **Concurrence optimiste** — `FantasyTeamSeason` utilise la colonne système `xmin` de Postgres comme token de concurrence, avec retry borné pour les races entre recompute de saison et live updates pendant les matchs.

- **Gestion salariale** — les contrats avec rétention salariale sont marqués avec un `ProtectedSalary` qui persiste à travers les syncs CapFreeze et disparaît automatiquement à la fin du contrat, quand CapFreeze renvoie un nouveau contrat.

- **Data Protection persisté en DB** — la clé de chiffrement des cookies est stockée dans la base de données pour que les sessions utilisateur survivent à un redéploiement du conteneur API.

## Lancer localement

Prérequis : .NET 8 SDK, Node.js 22, PostgreSQL 18 (ou Docker).

```bash
# Backend (depuis la racine du repo)
dotnet restore
dotnet ef database update
dotnet run   # écoute sur https://localhost:7081

# Frontend (nouveau terminal)
cd frontend
npm install
npm run dev  # écoute sur http://localhost:5173, proxy /api → https://localhost:7081


Variables à configurer dans appsettings.Development.json :

ConnectionStrings:DefaultConnection — chaîne PostgreSQL

Auth:InviteCode — code d'invitation pour créer un compte

Auth:CommissionerUsernames — tableau des comptes commissaire


Déploiement
Voir docker-compose.example.yml pour la topologie. Le déploiement réel tourne sur un VPS OVH avec Docker Compose (trois services : db, api, web), et Nginx sert de reverse proxy vers l'API sur /api/*. Les Dockerfiles du backend et du frontend sont à la racine et dans frontend/.