import baseData from "@emoji-mart/data";

// Emoji Mart traduce la interfaz con locale="es", pero su índice de búsqueda
// sigue viniendo con palabras clave en inglés. Enriquecemos esas keywords con
// alias en español para que búsquedas como "mano", "corazón", "perro", etc.
// devuelvan resultados sin perder compatibilidad con búsquedas anteriores.
const SEARCH_GROUPS = [
  { es: ["mano", "manos"], en: ["hand", "hands", "palm", "finger", "fingers", "thumb", "fist", "clap", "wave", "gesture"] },
  { es: ["dedo", "dedos"], en: ["finger", "fingers", "index", "thumb", "pointing"] },
  { es: ["aplauso", "aplaudir", "aplausos"], en: ["clap", "clapping", "applause"] },
  { es: ["saludo", "saludar"], en: ["wave", "waving", "hello", "goodbye"] },
  { es: ["puño", "punio"], en: ["fist", "punch"] },
  { es: ["pulgar", "bien", "ok"], en: ["thumb", "thumbs up", "like", "approve", "ok"] },
  { es: ["rezar", "gracias", "por favor"], en: ["pray", "prayer", "please", "thanks", "thank you", "folded hands"] },
  { es: ["cara", "rostro"], en: ["face", "faces"] },
  { es: ["sonrisa", "sonreír", "sonreir", "feliz", "alegre"], en: ["smile", "smiling", "happy", "joy", "grin", "grinning"] },
  { es: ["risa", "reír", "reir", "carcajada"], en: ["laugh", "laughing", "lol", "rofl", "joy"] },
  { es: ["triste", "tristeza", "llorar", "llanto"], en: ["sad", "cry", "crying", "tear", "tears"] },
  { es: ["enojo", "enojado", "enojada", "bronca"], en: ["angry", "anger", "mad", "rage"] },
  { es: ["miedo", "asustado", "asustada"], en: ["fear", "scared", "afraid", "scream"] },
  { es: ["sorpresa", "sorprendido", "sorprendida"], en: ["surprised", "surprise", "astonished", "wow"] },
  { es: ["amor", "enamorado", "enamorada"], en: ["love", "loving", "romance", "romantic"] },
  { es: ["beso", "besar"], en: ["kiss", "kissing"] },
  { es: ["corazón", "corazon", "corazones"], en: ["heart", "hearts"] },
  { es: ["roto", "corazón roto", "corazon roto"], en: ["broken heart", "heartbreak", "broken"] },
  { es: ["fuego", "llama"], en: ["fire", "flame", "hot"] },
  { es: ["estrella", "estrellas"], en: ["star", "stars", "sparkle", "sparkles"] },
  { es: ["brillo", "brillos", "brillante"], en: ["sparkle", "sparkles", "shiny", "glitter"] },
  { es: ["sol"], en: ["sun", "sunny"] },
  { es: ["luna"], en: ["moon", "lunar"] },
  { es: ["nube", "nubes"], en: ["cloud", "cloudy"] },
  { es: ["lluvia", "llover"], en: ["rain", "rainy", "umbrella"] },
  { es: ["nieve", "nevar"], en: ["snow", "snowy", "snowflake"] },
  { es: ["rayo", "tormenta"], en: ["lightning", "thunder", "storm"] },
  { es: ["agua", "gota", "gotas"], en: ["water", "drop", "droplet", "sweat"] },
  { es: ["flor", "flores"], en: ["flower", "flowers", "blossom", "rose", "tulip"] },
  { es: ["rosa"], en: ["rose"] },
  { es: ["árbol", "arbol", "árboles", "arboles"], en: ["tree", "trees", "evergreen", "palm tree"] },
  { es: ["hoja", "hojas"], en: ["leaf", "leaves"] },
  { es: ["animal", "animales"], en: ["animal", "animals"] },
  { es: ["perro", "perros"], en: ["dog", "puppy"] },
  { es: ["gato", "gatos"], en: ["cat", "kitten"] },
  { es: ["ratón", "raton"], en: ["mouse", "rat"] },
  { es: ["conejo"], en: ["rabbit", "bunny"] },
  { es: ["oso"], en: ["bear"] },
  { es: ["mono"], en: ["monkey", "ape"] },
  { es: ["león", "leon"], en: ["lion"] },
  { es: ["tigre"], en: ["tiger"] },
  { es: ["vaca"], en: ["cow", "cattle"] },
  { es: ["cerdo", "chancho"], en: ["pig"] },
  { es: ["caballo"], en: ["horse"] },
  { es: ["oveja"], en: ["sheep", "ewe"] },
  { es: ["pájaro", "pajaro", "ave"], en: ["bird", "birds"] },
  { es: ["gallina", "pollo"], en: ["chicken", "hen", "rooster"] },
  { es: ["pingüino", "pinguino"], en: ["penguin"] },
  { es: ["pez", "pescado"], en: ["fish"] },
  { es: ["delfín", "delfin"], en: ["dolphin"] },
  { es: ["ballena"], en: ["whale"] },
  { es: ["tiburón", "tiburon"], en: ["shark"] },
  { es: ["mariposa"], en: ["butterfly"] },
  { es: ["abeja"], en: ["bee", "honeybee"] },
  { es: ["hormiga"], en: ["ant"] },
  { es: ["araña", "arana"], en: ["spider"] },
  { es: ["comida", "comer", "alimento"], en: ["food", "eat", "eating", "meal"] },
  { es: ["fruta", "frutas"], en: ["fruit", "fruits"] },
  { es: ["manzana"], en: ["apple"] },
  { es: ["banana", "plátano", "platano"], en: ["banana"] },
  { es: ["naranja"], en: ["orange", "tangerine"] },
  { es: ["limón", "limon"], en: ["lemon"] },
  { es: ["uva", "uvas"], en: ["grapes"] },
  { es: ["sandía", "sandia"], en: ["watermelon"] },
  { es: ["frutilla", "fresa"], en: ["strawberry"] },
  { es: ["cereza", "cerezas"], en: ["cherry", "cherries"] },
  { es: ["verdura", "verduras"], en: ["vegetable", "vegetables"] },
  { es: ["tomate"], en: ["tomato"] },
  { es: ["zanahoria"], en: ["carrot"] },
  { es: ["pan"], en: ["bread", "baguette"] },
  { es: ["queso"], en: ["cheese"] },
  { es: ["carne"], en: ["meat", "steak"] },
  { es: ["hamburguesa"], en: ["burger", "hamburger"] },
  { es: ["pizza"], en: ["pizza"] },
  { es: ["papas", "papas fritas"], en: ["fries", "french fries"] },
  { es: ["helado"], en: ["ice cream"] },
  { es: ["torta", "pastel"], en: ["cake", "birthday cake"] },
  { es: ["galleta"], en: ["cookie"] },
  { es: ["chocolate"], en: ["chocolate"] },
  { es: ["café", "cafe"], en: ["coffee", "hot beverage"] },
  { es: ["té", "te"], en: ["tea", "teacup"] },
  { es: ["cerveza"], en: ["beer"] },
  { es: ["vino"], en: ["wine"] },
  { es: ["auto", "coche", "carro"], en: ["car", "automobile", "vehicle"] },
  { es: ["camión", "camion"], en: ["truck", "lorry"] },
  { es: ["colectivo", "autobús", "autobus", "micro"], en: ["bus"] },
  { es: ["tren"], en: ["train", "railway"] },
  { es: ["avión", "avion"], en: ["airplane", "plane", "flight"] },
  { es: ["barco"], en: ["ship", "boat"] },
  { es: ["bicicleta", "bici"], en: ["bicycle", "bike"] },
  { es: ["moto", "motocicleta"], en: ["motorcycle", "motorbike"] },
  { es: ["casa", "hogar"], en: ["house", "home"] },
  { es: ["escuela", "colegio"], en: ["school"] },
  { es: ["hospital"], en: ["hospital"] },
  { es: ["iglesia"], en: ["church"] },
  { es: ["trabajo", "trabajar"], en: ["work", "working", "office"] },
  { es: ["dinero", "plata", "pago"], en: ["money", "cash", "dollar", "payment", "pay"] },
  { es: ["tarjeta"], en: ["card", "credit card"] },
  { es: ["regalo"], en: ["gift", "present"] },
  { es: ["fiesta", "festejo", "celebración", "celebracion"], en: ["party", "celebration", "celebrate"] },
  { es: ["cumpleaños", "cumpleanos"], en: ["birthday"] },
  { es: ["navidad"], en: ["christmas", "santa"] },
  { es: ["año nuevo", "ano nuevo"], en: ["new year"] },
  { es: ["música", "musica"], en: ["music", "musical"] },
  { es: ["canción", "cancion"], en: ["song"] },
  { es: ["película", "pelicula", "cine"], en: ["movie", "film", "cinema"] },
  { es: ["foto", "cámara", "camara"], en: ["photo", "camera", "picture"] },
  { es: ["teléfono", "telefono", "celular"], en: ["phone", "telephone", "mobile", "cellphone"] },
  { es: ["computadora", "ordenador", "pc"], en: ["computer", "desktop", "laptop"] },
  { es: ["reloj", "hora"], en: ["clock", "watch", "time"] },
  { es: ["calendario", "fecha"], en: ["calendar", "date"] },
  { es: ["llave", "llaves"], en: ["key", "keys"] },
  { es: ["candado"], en: ["lock", "locked"] },
  { es: ["libro", "libros"], en: ["book", "books"] },
  { es: ["lápiz", "lapiz"], en: ["pencil", "write", "writing"] },
  { es: ["tijera", "tijeras"], en: ["scissors"] },
  { es: ["pelota", "balón", "balon"], en: ["ball"] },
  { es: ["fútbol", "futbol"], en: ["soccer", "football"] },
  { es: ["básquet", "basquet", "baloncesto"], en: ["basketball"] },
  { es: ["tenis"], en: ["tennis"] },
  { es: ["trofeo", "copa"], en: ["trophy", "cup", "winner"] },
  { es: ["medalla"], en: ["medal"] },
  { es: ["bandera"], en: ["flag"] },
  { es: ["argentina", "argentino", "argentina bandera"], en: ["argentina", "flag argentina"] },
  { es: ["sí", "si", "correcto", "aprobado"], en: ["yes", "check", "correct", "approved"] },
  { es: ["no", "incorrecto", "prohibido"], en: ["no", "cross", "wrong", "prohibited"] },
  { es: ["alerta", "advertencia", "cuidado"], en: ["warning", "alert", "caution"] },
  { es: ["pregunta", "duda"], en: ["question"] },
  { es: ["información", "informacion"], en: ["information", "info"] },
  { es: ["nuevo", "nueva"], en: ["new"] },
  { es: ["arriba"], en: ["up", "upward"] },
  { es: ["abajo"], en: ["down", "downward"] },
  { es: ["izquierda"], en: ["left"] },
  { es: ["derecha"], en: ["right"] },
  { es: ["hombre"], en: ["man", "male"] },
  { es: ["mujer"], en: ["woman", "female"] },
  { es: ["persona", "personas", "gente"], en: ["person", "people", "personality"] },
  { es: ["niño", "nino", "niña", "nina", "chico", "chica"], en: ["child", "boy", "girl", "kid"] },
  { es: ["bebé", "bebe"], en: ["baby"] },
  { es: ["familia"], en: ["family"] },
  { es: ["amigo", "amiga", "amigos"], en: ["friend", "friends"] },
  { es: ["profesor", "profesora", "docente"], en: ["teacher"] },
  { es: ["médico", "medico", "doctora", "doctor"], en: ["doctor", "health worker", "medical"] },
  { es: ["policía", "policia"], en: ["police", "officer"] },
  { es: ["bombero", "bombera"], en: ["firefighter"] },
  { es: ["robot"], en: ["robot"] },
  { es: ["fantasma"], en: ["ghost"] },
  { es: ["calavera", "cráneo", "craneo"], en: ["skull"] },
  { es: ["caca", "popó", "popo"], en: ["poop", "pile of poo"] },
];

const fold = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const withAccentlessVariant = (values) => {
  const out = new Set();
  (values || []).forEach((value) => {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return;
    out.add(text);
    const plain = fold(text);
    if (plain) out.add(plain);
  });
  return Array.from(out);
};

const matchesEnglishTerm = (haystack, term) => {
  const needle = fold(term);
  if (!needle) return false;
  return (` ${haystack} `).includes(` ${needle} `);
};

const buildSpanishEmojiData = () => {
  if (!baseData || !baseData.emojis || typeof baseData.emojis !== "object") {
    return baseData;
  }

  const emojis = {};

  Object.entries(baseData.emojis).forEach(([id, emoji]) => {
    const originalKeywords = Array.isArray(emoji?.keywords) ? emoji.keywords : [];
    const searchable = fold([id, emoji?.name, ...originalKeywords].filter(Boolean).join(" "));
    const spanishAliases = [];

    SEARCH_GROUPS.forEach((group) => {
      if ((group.en || []).some((term) => matchesEnglishTerm(searchable, term))) {
        spanishAliases.push(...withAccentlessVariant(group.es));
      }
    });

    emojis[id] = {
      ...emoji,
      keywords: Array.from(new Set([...originalKeywords, ...spanishAliases])),
    };
  });

  return {
    ...baseData,
    emojis,
  };
};

const emojiDataEs = buildSpanishEmojiData();

export default emojiDataEs;
