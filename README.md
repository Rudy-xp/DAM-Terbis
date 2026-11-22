# DAM Terbis

Web app de gestion d'une base de photos et de PDF.
**Front** : React + Vite (TypeScript), hébergé sur **GitHub Pages**.
**Back** : **Supabase** (authentification, base Postgres, stockage de fichiers).

## Fonctionnalités

- Connexion / création de compte (e-mail + mot de passe)
- Envoi multiple par glisser-déposer (images et PDF, 50 Mo max par fichier), avec tags appliqués à l'envoi
- Grille de vignettes paginée, filtres Photos / PDF / Mes fichiers, filtre par tag
- Recherche par titre, description, nom de fichier ou tag
- Fiche détail : aperçu (image ou PDF intégré), édition titre / description / tags, téléchargement, suppression
- **Description et mots-clés générés par l'IA** (Claude) à l'envoi, modifiables ensuite ; bouton « Régénérer avec l'IA »
- Bibliothèque partagée entre les utilisateurs connectés ; seul l'auteur d'un envoi peut le modifier ou le supprimer

## Architecture Supabase

| Élément | Détail |
| --- | --- |
| Table `public.assets` | métadonnées (titre, description, tags, type, taille, dimensions, chemin du fichier, propriétaire) |
| Bucket `assets` (privé) | fichiers rangés sous `<user_id>/<uuid>.<ext>`, accès via URL signées (1 h) |
| RLS | lecture : tout utilisateur connecté ; écriture / suppression : propriétaire uniquement ; aucun accès anonyme |

| Edge Function `analyze-asset` | envoie la vignette (photo) ou le PDF à Claude, enregistre la description et fusionne les mots-clés avec les tags existants |

Le schéma est versionné dans `supabase/migrations/` (déjà appliqué sur le projet `fpoxrpybabtgzravwyea`).
Pour un autre projet : `supabase link --project-ref <ref>` puis `supabase db push`, ou coller les fichiers SQL dans l'éditeur SQL.

## Analyse IA

- Code : `supabase/functions/analyze-asset/index.ts` (déployée avec `supabase functions deploy analyze-asset`).
- Secret requis : `ANTHROPIC_API_KEY` (Supabase → Edge Functions → Secrets), clé créée sur console.anthropic.com.
- Les photos sont analysées à partir d'une vignette JPEG (1568 px max) générée dans le navigateur ; les PDF jusqu'à 23 Mo.
- Seul le propriétaire d'un fichier peut lancer l'analyse.

## Développement local

```bash
cp .env.example .env.local   # URL + clé publishable Supabase
npm install
npm run dev                  # http://localhost:5173
```

## Déploiement sur GitHub Pages

1. **Settings → Pages → Source : GitHub Actions**
2. **Settings → Secrets and variables → Actions → onglet Variables**, créer :
   - `VITE_SUPABASE_URL` = `https://fpoxrpybabtgzravwyea.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = la clé `sb_publishable_…` (publique par conception, la sécurité repose sur RLS)
3. Pousser sur `main` : le workflow `.github/workflows/deploy.yml` construit et publie le site sur
   `https://<utilisateur>.github.io/<repo>/`.
4. Dans **Supabase → Authentication → URL Configuration**, mettre cette adresse dans *Site URL* et
   *Redirect URLs* (sinon les liens de confirmation d'e-mail renvoient vers `localhost`).

## Sécurité : à régler dans Supabase

Tout compte créé a accès à la bibliothèque. Pour un usage interne, une fois vos comptes créés,
désactivez les inscriptions publiques : **Authentication → Sign In / Providers → décocher « Allow new users to sign up »**,
puis invitez les nouveaux utilisateurs depuis **Authentication → Users → Invite**.
