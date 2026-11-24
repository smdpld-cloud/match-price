const express = require('express');
const fs = require('fs');
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const magasinsPrincipaux = ['Super C', 'Maxi', 'Walmart', 'IGA', 'Metro'];

let catalogueEnMemoire = {};
try {
  catalogueEnMemoire = JSON.parse(fs.readFileSync('catalogue.json', 'utf-8'));
  console.log(`📚 Catalogue chargé en mémoire : ${Object.keys(catalogueEnMemoire).length} entrées`);
} catch {
  console.log('⚠️ catalogue.json introuvable ou vide au démarrage.');
}

const marquesConnues = new Set([
  'olymel', 'lafleur', 'sans', 'nom', 'great', 'value', 'selection',
  'compliments', 'irresistibles', 'natrel', 'lactantia', 'quebon',
  'kraft', 'saputo', 'dempster', 'pom', 'gadoua', 'sealtest', 'beatrice',
  'barilla', 'catelli', 'primo', 'knorr', 'campbell', 'campbells', 'st', 'methode'
]);

function normaliser(texte) {
  return (texte || '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d)\s*(%|l|ml|g|kg|un)\b/g, '$1$2') // Uniformise "2 %" -> "2%" et "2 l" -> "2l"
    .replace(/[^a-z0-9%.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function corrigerMot(mot) {
  return mot
    .replace(/^yaourt/, 'yogourt')
    .replace(/^celerie$/, 'celeri')
    .replace(/^seleri$/, 'celeri')
    .replace(/^brocolli$/, 'brocoli')
    .replace(/^spagetti$/, 'spaghetti')
    .replace(/s$/, '');
}

function contientTousLesMots(requete, texteProduit) {
  const motsReq = normaliser(requete).split(' ').filter(Boolean);
  const motsTitre = normaliser(texteProduit).split(' ').filter(Boolean);
  if (motsReq.length === 0) return false;

  return motsReq.every(mr => {
    if (mr === 'oeuf' || mr === 'oeufs') {
      return motsTitre.some(mt => mt === 'oeuf' || mt === 'oeufs');
    }
    if (/^\d/.test(mr)) {
      return motsTitre.some(mt => mt === mr || mt.startsWith(mr));
    }
    const r = corrigerMot(mr);
    return motsTitre.some(mt => {
      const t = corrigerMot(mt);
      return t === r || (r.length >= 4 && t.startsWith(r));
    });
  });
}

function estCoherent(requete, titreProduit) {
  const titreFrancais = (titreProduit || '').split('|')[0];
  const q = normaliser(requete);
  const t = normaliser(titreFrancais);
  const motsReq = q.split(' ').filter(Boolean);
  if (motsReq.length === 0) return true;

  // 1. Tous les mots demandés doivent être présents
  if (!contientTousLesMots(q, t)) return false;

  // 2. Exclut animaux et simili-viande végétale (sauf si demandé)
  const interditsGlobaux = [
    'chien', 'chiens', 'chat', 'chats', 'whiskas', 'pedigree', 'friskies', 'purina',
    'vegetal', 'vegetale', 'vegetaux', 'vegetalien', 'vegan', 'sans viande', 'simili',
    'antisudorifique', 'deodorant', 'shampooing', 'savon'
  ];
  for (const mot of interditsGlobaux) {
    if (!q.includes(mot) && new RegExp(`\\b${mot}\\b`).test(t)) return false;
  }

  // 3. RÈGLE GRAMMATICALE UNIVERSELLE :
  // Si l'aliment cherché est précédé de "et / au / aux / a la / avec / saveur / gout / pour",
  // c'est un plat préparé ou une saveur ("pâtes AU bacon", "chocolat AU lait", "sauce POUR pâtes") -> REJETÉ !
  const motPrincipal = motsReq.find(m => m.length > 2 && !/^\d/.test(m) && !marquesConnues.has(m)) || motsReq[0];
  const racine = corrigerMot(motPrincipal);

  const regexIngredientSecondaire = new RegExp(`\\b(et|au|aux|a la|a l|avec|saveur|gout|pour)\\s+${racine}`);
  if (regexIngredientSecondaire.test(t) && !regexIngredientSecondaire.test(q)) {
    return false;
  }

  // 4. RÈGLE DES DÉRIVÉS ("beurre D'arachide", "lait DE coco", "vinaigre DE vin") :
  // Si l'aliment est suivi de "de / d", on rejette sauf si c'est un qualificatif naturel
  const matchDerive = t.match(new RegExp(`\\b${racine}s?\\s+(de|d)\\s+([a-z]+)`));
  if (matchDerive) {
    const qual = matchDerive[2];
    const qualValides = ['vache', 'ferme', 'poule', 'poules', 'table', 'boulangerie', 'menage', 'fume', 'tranche', 'erable', 'ble', 'semoule', 'porc', 'rave', 'mer', 'terre'];
    if (!qualValides.includes(qual) && !q.includes(qual)) {
      return false;
    }
  }

  // 5. Si précédé de "de / d" ("vinaigre DE vin", "morceaux DE bacon", "sauce DE tomate"),
  // on autorise uniquement les contenants/coupes normaux ("coeurs de céleri", "poitrines de poulet", "bouteille de vin")
  const matchContenant = t.match(new RegExp(`\\b([a-z]+)\\s+(de|d)\\s+${racine}`));
  if (matchContenant && !t.startsWith(racine)) {
    const avant = matchContenant[1];
    const contenantsValides = ['coeur', 'coeurs', 'branche', 'branches', 'botte', 'poitrine', 'poitrines', 'cuisse', 'cuisses', 'filet', 'filets', 'sac', 'boite', 'bouteille', 'paquet', 'tranche', 'tranches', 'douzaine', 'brique', 'pot', 'pinte', 'carton'];
    if (!contenantsValides.includes(avant) && !q.includes(avant)) {
      return false;
    }
  }

  // 6. Filtres spécifiques indispensables (lait liquide vs évaporé, pain tranché vs burger)
  if (racine === 'lait') {
    const fauxLaits = ['evapore', 'condense', 'poudre', 'babeurre', 'infantile'];
    if (!fauxLaits.some(f => q.includes(f)) && fauxLaits.some(f => new RegExp(`\\b${f}\\b`).test(t))) return false;
  }

  if (racine === 'pain') {
    const painsSpeciaux = ['hamburger', 'hamburgers', 'hot dog', 'kaiser', 'pita', 'naan', 'bagel', 'baguette', 'brioche', 'croissant', 'muffin', 'tortilla', 'grille', 'banane', 'raisin'];
    if (!painsSpeciaux.some(f => q.includes(f)) && painsSpeciaux.some(f => new RegExp(`\\b${f}\\b`).test(t))) return false;
  }

  if (q === 'chou' || q === 'choux') {
    if (t.includes('chou fleur') || t.includes('bruxelles')) return false;
  }

  return true;
}

function extraireRequeteGenerique(requete) {
  const mots = normaliser(requete).split(' ').filter(Boolean);
  const sansMarque = mots.filter(m => !marquesConnues.has(m));
  if (sansMarque.length === 0 || sansMarque.length === mots.length) return null;
  return sansMarque.join(' ');
}

function chercherDansCatalogue(catalogue, requete) {
  const correspondances = [];
  for (const [cle, produit] of Object.entries(catalogue)) {
    if (!produit || !produit.offres) continue;
    const offresFiltrees = {};
    let aDesOffres = false;

    for (const [magasin, offre] of Object.entries(produit.offres)) {
      if (estCoherent(requete, `${cle} ${offre.nom || ''}`)) {
        offresFiltrees[magasin] = offre;
        aDesOffres = true;
      }
    }
    if (aDesOffres) correspondances.push({ cle, offres: offresFiltrees });
  }
  return correspondances;
}

async function rechercherFlipp(cp, requete, exclureEnLigne) {
  const qNorm = normaliser(requete);
  let requeteApi = requete;
  if (qNorm === 'pain') requeteApi = 'pain tranche';
  else if (qNorm === 'pate' || qNorm === 'pates') requeteApi = 'pates alimentaires';
  else if (corrigerMot(qNorm) === 'celeri') requeteApi = 'celeri';

  const url = `https://backflipp.wishabi.com/flipp/items/search?locale=fr-ca&postal_code=${cp}&q=${encodeURIComponent(requeteApi)}`;
  const reponse = await fetch(url);
  const donnees = await reponse.json();

  const vus = new Set();
  return (donnees.items || [])
    .filter(item => {
      if (!item.current_price || !item.merchant_name) return false;
      if (exclureEnLigne && item.merchant_name.toLowerCase().includes('lufa')) return false;

      const titreFrancais = (item.name || '').split('|')[0].trim();
      if (!estCoherent(requete, `${titreFrancais} ${item.brand || ''}`)) return false;

      const cleDoublon = `${item.merchant_name.toLowerCase()}|${titreFrancais.toLowerCase()}|${item.current_price}`;
      if (vus.has(cleDoublon)) return false;
      vus.add(cleDoublon);
      return true;
    })
    .map(item => ({
      ...item,
      name: (item.name || '').split('|')[0].trim()
    }))
    .sort((a, b) => parseFloat(a.current_price) - parseFloat(b.current_price));
}

app.post('/api/calculer', async (req, res) => {
  const { codePostal, articles, exclureEnLigne } = req.body;
  const cp = (codePostal || 'J8B1A1').replace(/\s+/g, '').toUpperCase();

  try {
    const details = [];

    for (const articleBrut of articles) {
      const article = articleBrut.trim();
      if (!article) continue;

      const speciauxExact = await rechercherFlipp(cp, article, exclureEnLigne);
      const catalogueExact = chercherDansCatalogue(catalogueEnMemoire, article);

      const requeteGenerique = extraireRequeteGenerique(article);
      let speciauxEquiv = [];
      let catalogueEquiv = [];
      if (requeteGenerique) {
        speciauxEquiv = await rechercherFlipp(cp, requeteGenerique, exclureEnLigne);
        catalogueEquiv = chercherDansCatalogue(catalogueEnMemoire, requeteGenerique);
      }

      const optionsParMagasin = {};

      for (const magasin of magasinsPrincipaux) {
        const speciauxMag = speciauxExact
          .filter(s => s.merchant_name.toLowerCase().includes(magasin.toLowerCase()))
          .map(s => ({
            prix: parseFloat(s.current_price),
            prixUnitaire: '',
            type: 'SPÉCIAL',
            titre: s.name,
            magasin: s.merchant_name,
            image: s.clean_image_url || s.clipping_image_url || '',
            valideJusqua: s.valid_to ? s.valid_to.split('T')[0] : ''
          }));

        const reguliersMag = catalogueExact
          .filter(p => p.offres && p.offres[magasin])
          .map(p => ({
            prix: p.offres[magasin].prix,
            prixUnitaire: p.offres[magasin].prixUnitaire || '',
            type: 'Régulier',
            titre: p.offres[magasin].nom,
            magasin: magasin,
            image: p.offres[magasin].image || '',
            valideJusqua: ''
          }));

        let offresMagasin = [...speciauxMag, ...reguliersMag].sort((a, b) => a.prix - b.prix);

        if (offresMagasin.length === 0 && requeteGenerique) {
          const specEquivMag = speciauxEquiv
            .filter(s => s.merchant_name.toLowerCase().includes(magasin.toLowerCase()))
            .map(s => ({
              prix: parseFloat(s.current_price),
              prixUnitaire: '',
              type: 'SPÉCIAL',
              titre: `🔄 Équivalent : ${s.name}`,
              magasin: s.merchant_name,
              image: s.clean_image_url || s.clipping_image_url || '',
              valideJusqua: s.valid_to ? s.valid_to.split('T')[0] : ''
            }));

          const regEquivMag = catalogueEquiv
            .filter(p => p.offres && p.offres[magasin])
            .map(p => ({
              prix: p.offres[magasin].prix,
              prixUnitaire: p.offres[magasin].prixUnitaire || '',
              type: 'Équivalent',
              titre: `🔄 Équivalent : ${p.offres[magasin].nom}`,
              magasin: magasin,
              image: p.offres[magasin].image || '',
              valideJusqua: ''
            }));

          offresMagasin = [...specEquivMag, ...regEquivMag].sort((a, b) => a.prix - b.prix);
        }

        optionsParMagasin[magasin] = offresMagasin.slice(0, 4);
      }

      const toutesLesOffres = [
        ...speciauxExact.map(s => ({
          prix: parseFloat(s.current_price),
          prixUnitaire: '',
          magasin: s.merchant_name,
          titre: s.name,
          type: 'SPÉCIAL',
          image: s.clean_image_url || s.clipping_image_url || '',
          valideJusqua: s.valid_to ? s.valid_to.split('T')[0] : ''
        })),
        ...Object.values(optionsParMagasin).flat().filter(o => o.type === 'Régulier')
      ]
      .sort((a, b) => a.prix - b.prix)
      .slice(0, 4);

      details.push({
        article,
        optionsParMagasin,
        optionsGlobales: toutesLesOffres,
        indexChoixMagasin: { 'Super C': 0, 'Maxi': 0, 'Walmart': 0, 'IGA': 0, 'Metro': 0 },
        indexChoixGlobal: 0
      });
    }

    res.json({ codePostal: cp, magasinsPrincipaux, details });
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur Match Price propre prêt sur le port ${PORT}`);
});