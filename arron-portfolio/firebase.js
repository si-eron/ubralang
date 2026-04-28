export const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_FIREBASE_AUTH_DOMAIN",
  projectId: "YOUR_FIREBASE_PROJECT_ID",
  storageBucket: "YOUR_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "YOUR_FIREBASE_MESSAGING_SENDER_ID",
  appId: "YOUR_FIREBASE_APP_ID",
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (value) => value && !String(value).startsWith("YOUR_FIREBASE")
);

export const DEFAULT_CONTENT = {
  hero: {
    brand: "",
    firstName: "Arron",
    lastName: "Aperocho",
    fullName: "Arron Aperocho",
    role: "Filmmaker & Video Editor",
    subtitle: "Filmmaker, Video Editor & Graphics Designer \u2014 crafting compelling visual stories since 2018.",
    availability: "Available for projects",
    email: "arronaperocho1@gmail.com",
    profileImage: "",
    profileCaption: "Filmmaker & Video Editor",
  },
  stats: [
    {
      key: "experience",
      value: 6,
      suffix: "+",
      label: "Years Experience",
    },
    {
      key: "awards",
      value: 22,
      suffix: "+",
      label: "Awards Won",
      link: "https://drive.google.com/drive/folders/1qoZBktyz80mbKanHOcm0O46RSruMlDE6?usp=sharing",
    },
    {
      key: "projects",
      value: 30,
      suffix: "+",
      label: "Projects Delivered",
    },
    {
      key: "campaigns",
      value: 15,
      suffix: "+",
      label: "Marketing Campaigns",
    },
  ],
  carousel: {
    heading: "Work Highlights",
  },
  about: {
    heading: "About Me",
    paragraphs: [
      "I'm Arron Aperocho, a filmmaker and video editor who started editing in 2018 and began filmmaking in 2019 through Abri Balangaw. Since then, I've worked across student films, organization projects, SME video work, and marketing campaigns.",
      "My work is grounded in storytelling and editing. I focus on shaping clear visual narratives, from planning and shooting to pacing, color, sound, and final delivery.",
      "Through student films, org work, and small business projects, I've learned to balance creative intent with practical production needs. I aim to make each project feel honest, polished, and emotionally clear.",
    ],
    skills: [
      "Cinematography",
      "Video Editing",
      "Color Grading",
      "Motion Graphics",
      "Creative Direction",
      "Marketing Video",
      "Short Film",
      "Graphic Design",
    ],
  },
  journey: {
    heading: "Journey",
  },
  timeline: [
    {
      year: "2018",
      title: "Started Video Editing",
      description: "Began learning video editing and visual storytelling.",
    },
    {
      year: "2019",
      title: "Started Filmmaking Journey",
      description: "Entered filmmaking through Abri Balangaw.",
    },
    {
      year: "2020\u2013Present",
      title: "Marketing & Video Production Work",
      description: "Created promotional content for organizations, campaigns, and SME projects.",
    },
    {
      year: "2019\u2013Present",
      title: "Award-Winning Film Projects",
      description: "Contributed to film projects recognized through awards and screenings.",
    },
    {
      year: "Present",
      title: "Filmmaker & Video Editor",
      description: "Continuing to craft clear, compelling video work across formats.",
    },
  ],
  featured: {
    heading: "Featured Work",
    subtitle: "Click any category to explore the full collection",
    cards: [
      {
        title: "Graphic Design",
        description:
          "A curated collection of visual design work spanning brand identities, digital graphics, motion graphics, and creative layouts \u2014 each piece crafted with a keen eye for composition, color, and communication.",
        url: "https://drive.google.com/drive/folders/1qA_P-A7FqMm_O_W5l-TR388OQpU-PvZ6?usp=sharing",
        theme: "violet",
        icon: "palette",
      },
      {
        title: "Show Reel",
        description:
          "A highlight reel personally shot and edited by Arron Aperocho \u2014 capturing his best work across commercial, narrative, and documentary formats. Every frame was captured behind the lens and refined in the edit suite.",
        url: "https://drive.google.com/drive/folders/1XZbO98Q9HXx19wRJrlEWb2gVntVD_esH?usp=sharing",
        theme: "rose",
        icon: "clapper",
      },
      {
        title: "Video Works",
        description:
          "A comprehensive archive of video productions personally shot and edited by Arron \u2014 ranging from award-winning short films to high-impact marketing campaigns, blending technical precision with compelling narrative.",
        url: "https://drive.google.com/drive/folders/1RMXsd8N0vWHwv9zP6YP0h4Gh5PMQMHez?usp=drive_link",
        theme: "gold",
        icon: "film",
      },
    ],
  },
  contact: {
    heading: "Let's Create Something Together",
    copy: "Whether you need a marketing video, visual content, or creative direction \u2014 reach out and let\u2019s talk.",
  },
  tools: [
    {
      name: "Adobe Premiere Pro",
      iconUrl: "",
      path: "",
      link: "",
    },
    {
      name: "CapCut",
      iconUrl: "",
      path: "",
      link: "",
    },
    {
      name: "Canva",
      iconUrl: "",
      path: "",
      link: "",
    },
    {
      name: "Adobe Lightroom",
      iconUrl: "",
      path: "",
      link: "",
    },
    {
      name: "Adobe After Effects",
      iconUrl: "",
      path: "",
      link: "",
    },
  ],
};

const FIREBASE_VERSION = "10.12.5";
const FIREBASE_APP_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`;
const FIREBASE_FIRESTORE_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`;
const FIREBASE_STORAGE_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-storage.js`;

let app = null;
let firebaseApi = null;
export let db = null;
export let storage = null;

export async function loadSiteContent() {
  if (!isFirebaseConfigured) {
    return clone(DEFAULT_CONTENT);
  }

  const { doc, getDoc } = await getFirebaseApi();
  const snapshot = await getDoc(doc(db, "site", "content"));
  if (!snapshot.exists()) {
    return clone(DEFAULT_CONTENT);
  }

  return mergeContent(DEFAULT_CONTENT, snapshot.data());
}

export async function saveSiteContent(content) {
  const { doc, setDoc } = await getFirebaseApi();
  await setDoc(doc(db, "site", "content"), content, { merge: true });
  return content;
}

export async function loadCarouselImages() {
  if (!isFirebaseConfigured) {
    return [];
  }

  const { collection, getDocs, orderBy, query } = await getFirebaseApi();
  const imageQuery = query(collection(db, "carouselImages"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(imageQuery);

  return snapshot.docs.map((imageDoc) => ({
    id: imageDoc.id,
    ...imageDoc.data(),
  }));
}

export async function uploadProfileImage(file) {
  const { getDownloadURL, ref, uploadBytes } = await getFirebaseApi();
  const path = `profile/${Date.now()}-${safeFileName(file.name)}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

export async function uploadCarouselImage(file) {
  const { addDoc, collection, getDownloadURL, ref, serverTimestamp, uploadBytes } = await getFirebaseApi();
  const path = `carousel/${Date.now()}-${safeFileName(file.name)}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);

  const imageRecord = {
    name: file.name,
    path,
    url,
    alt: file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
    createdAt: serverTimestamp(),
  };

  const created = await addDoc(collection(db, "carouselImages"), imageRecord);
  return { id: created.id, ...imageRecord };
}

export async function uploadToolIcon(file) {
  const { getDownloadURL, ref, uploadBytes } = await getFirebaseApi();
  const path = `tools/${Date.now()}-${safeFileName(file.name)}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);

  return {
    name: file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
    iconUrl: await getDownloadURL(storageRef),
    path,
    link: "",
  };
}

export async function deleteCarouselImage(image) {
  const { deleteDoc, deleteObject, doc, ref } = await getFirebaseApi();

  if (image.path) {
    await deleteObject(ref(storage, image.path)).catch(() => undefined);
  }

  if (image.id) {
    await deleteDoc(doc(db, "carouselImages", image.id));
  }
}

export async function deleteStoredFile(path) {
  if (!path) return;

  const { deleteObject, ref } = await getFirebaseApi();
  await deleteObject(ref(storage, path)).catch(() => undefined);
}

async function getFirebaseApi() {
  assertConfigured();

  if (firebaseApi) {
    return firebaseApi;
  }

  const [appModule, firestoreModule, storageModule] = await Promise.all([
    import(FIREBASE_APP_URL),
    import(FIREBASE_FIRESTORE_URL),
    import(FIREBASE_STORAGE_URL),
  ]);

  app = appModule.initializeApp(firebaseConfig);
  db = firestoreModule.getFirestore(app);
  storage = storageModule.getStorage(app);

  firebaseApi = {
    addDoc: firestoreModule.addDoc,
    collection: firestoreModule.collection,
    deleteDoc: firestoreModule.deleteDoc,
    doc: firestoreModule.doc,
    getDoc: firestoreModule.getDoc,
    getDocs: firestoreModule.getDocs,
    orderBy: firestoreModule.orderBy,
    query: firestoreModule.query,
    serverTimestamp: firestoreModule.serverTimestamp,
    setDoc: firestoreModule.setDoc,
    deleteObject: storageModule.deleteObject,
    getDownloadURL: storageModule.getDownloadURL,
    ref: storageModule.ref,
    uploadBytes: storageModule.uploadBytes,
  };

  return firebaseApi;
}

function assertConfigured() {
  if (!isFirebaseConfigured) {
    throw new Error("Firebase is not configured. Add your project keys in firebase.js first.");
  }
}

function safeFileName(name) {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeContent(base, incoming) {
  const output = clone(base);

  Object.keys(incoming || {}).forEach((key) => {
    if (
      incoming[key] &&
      typeof incoming[key] === "object" &&
      !Array.isArray(incoming[key]) &&
      typeof output[key] === "object" &&
      !Array.isArray(output[key])
    ) {
      output[key] = mergeContent(output[key], incoming[key]);
      return;
    }

    output[key] = incoming[key];
  });

  return output;
}
