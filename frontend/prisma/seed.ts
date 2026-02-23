import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Skip seeding if data already exists (safe for repeated Vercel builds)
  const existingChapters = await prisma.chapter.count();
  if (existingChapters > 0) {
    console.log(`Database already has ${existingChapters} chapters, skipping seed.`);
    return;
  }

  console.log("Seeding database with sample radiology content...");

  // Chapter 1: Chest Radiology (Core Radiology)
  const ch1 = await prisma.chapter.upsert({
    where: { bookSource_number: { bookSource: "core_radiology", number: 1 } },
    update: {},
    create: {
      bookSource: "core_radiology",
      number: 1,
      title: "Chest Radiology",
      summary: `Chest radiography is the most commonly performed imaging examination worldwide. The systematic approach to chest X-ray interpretation is essential for any radiologist.

The standard PA (posteroanterior) and lateral views form the basis of chest imaging. Key anatomical landmarks include the trachea, carina, main bronchi, mediastinal contours, cardiac silhouette, lung fields, costophrenic angles, and the diaphragm.

The silhouette sign is a fundamental concept: when two structures of similar density are in contact, the border between them is obliterated. This helps localize pathology. For example, loss of the right heart border suggests right middle lobe pathology, while loss of the left heart border suggests lingular pathology.

Common pathological patterns include consolidation (airspace opacity with air bronchograms), ground-glass opacity, reticular pattern, nodular pattern, and honeycombing. Understanding these patterns and their differential diagnoses is crucial for the FMH2 exam.`,
      keyPoints: JSON.stringify([
        "PA chest X-ray: X-ray beam enters posteriorly, exits anteriorly - standard for upright patients",
        "AP chest X-ray: beam enters anteriorly - used for portable/bedside exams, magnifies the heart",
        "Silhouette sign: loss of a normal border indicates adjacent pathology of similar density",
        "Air bronchogram: air-filled bronchi visible within opacified lung indicates airspace disease",
        "Kerley B lines: short horizontal lines at lung periphery indicating interstitial edema/lymphangitic spread",
        "Meniscus sign: curved upper border of pleural effusion on upright CXR",
        "Deep sulcus sign: lucent costophrenic angle on supine film suggests pneumothorax",
        "Continuous diaphragm sign: gas outlining both hemidiaphragms suggests pneumomediastinum",
        "Golden S sign: central mass with distal atelectasis (typically right upper lobe collapse with hilar mass)",
        "Hampton hump: peripheral wedge-shaped opacity suggesting pulmonary infarction"
      ]),
      highYield: JSON.stringify([
        "Right middle lobe collapse: loss of right heart border on PA view, wedge-shaped opacity on lateral",
        "Tension pneumothorax is a clinical diagnosis - do NOT wait for imaging. Signs: mediastinal shift, flattened hemidiaphragm",
        "Miliary pattern (1-3mm nodules): TB, fungal infection, metastases (thyroid, melanoma, renal)",
        "Eggshell calcification of hilar lymph nodes: silicosis and sarcoidosis",
        "Unilateral hilar enlargement: lymphoma, lung cancer, sarcoidosis (bilateral more common in sarcoid)",
        "Bilateral hilar lymphadenopathy + erythema nodosum: Löfgren syndrome (acute sarcoidosis, good prognosis)"
      ]),
      mnemonics: JSON.stringify([
        {
          name: "ABCDE approach to CXR",
          content: "A = Airway (trachea, carina, bronchi), B = Bones (ribs, clavicles, spine), C = Cardiac (size, shape, borders), D = Diaphragm (costophrenic angles, free air), E = Everything else (mediastinum, lung fields, soft tissues)"
        },
        {
          name: "Causes of bilateral hilar lymphadenopathy: SHRIMP",
          content: "S = Sarcoidosis, H = Hodgkin lymphoma, R = Reactive (infection), I = Inorganic dust (silicosis, berylliosis), M = Metastases, P = Primary lung cancer"
        },
        {
          name: "Cavitating lung lesions: CAVITY",
          content: "C = Cancer (squamous cell), A = Autoimmune (GPA/Wegener), V = Vascular (septic emboli, infarct), I = Infection (TB, Staph, Klebsiella, fungal), T = Trauma, Y = Young (congenital: sequestration, CCAM)"
        }
      ]),
      memoryPalace: `Imagine entering a hospital lobby (your memory palace for Chest Radiology):

STATION 1 - ENTRANCE DOORS (PA vs AP): The front doors are glass (PA - beam goes through posterior to anterior). The back emergency doors are opaque (AP - portable, magnifies heart).

STATION 2 - RECEPTION DESK (Silhouette Sign): The receptionist's face merges with the wall behind her - you can't see her border because they're the same density. She represents pathology hiding against similar-density structures.

STATION 3 - ELEVATOR (Air Bronchogram): Inside the elevator, the cables (bronchi) are visible through foggy air (consolidated lung). Air in bronchi surrounded by opacified lung.

STATION 4 - STAIRWELL (Kerley B Lines): Short horizontal handrails at each landing represent Kerley B lines at the lung periphery - think interstitial edema or lymphangitic carcinomatosis.

STATION 5 - CAFETERIA (Miliary Pattern): Tiny millet seeds scattered across every table - this is the miliary pattern. The kitchen serves three dishes: TB tikka, Fungal soup, and Metastasis meatballs (thyroid, melanoma, renal).`
    },
  });

  // Questions for Chapter 1
  const ch1Questions = [
    {
      questionText: "A 45-year-old presents with cough and fever. Chest X-ray shows loss of the right heart border with an opacity in the right lung. Which lobe is most likely affected?",
      options: JSON.stringify(["Right upper lobe", "Right middle lobe", "Right lower lobe", "Left upper lobe"]),
      correctAnswer: 1,
      explanation: "Loss of the right heart border on PA view is the classic silhouette sign for right middle lobe pathology. The right heart border is formed by the right atrium, which is in contact with the right middle lobe. When the RML is consolidated or collapsed, it has the same density as the heart, obliterating the border.",
      difficulty: "easy",
      category: "Silhouette Sign",
    },
    {
      questionText: "Which radiographic sign is most suggestive of pneumothorax on a supine chest X-ray?",
      options: JSON.stringify(["Visceral pleural line", "Deep sulcus sign", "Meniscus sign", "Air bronchogram"]),
      correctAnswer: 1,
      explanation: "The deep sulcus sign (abnormally deep and lucent costophrenic angle) is the most reliable sign of pneumothorax on supine radiographs. Free air rises to the most non-dependent area, which is anterior and inferior in the supine position. The visceral pleural line is best seen on upright PA views.",
      difficulty: "medium",
      category: "Pneumothorax",
    },
    {
      questionText: "A chest X-ray shows bilateral hilar lymphadenopathy in a young woman with erythema nodosum and bilateral ankle arthralgia. What is the most likely diagnosis?",
      options: JSON.stringify(["Hodgkin lymphoma", "Tuberculosis", "Löfgren syndrome (sarcoidosis)", "Metastatic disease"]),
      correctAnswer: 2,
      explanation: "Löfgren syndrome is an acute presentation of sarcoidosis characterized by the triad of bilateral hilar lymphadenopathy, erythema nodosum, and polyarthralgia (especially ankles). It carries an excellent prognosis with >90% spontaneous resolution. This classic presentation is a high-yield topic for radiology board exams.",
      difficulty: "medium",
      category: "Sarcoidosis",
    },
    {
      questionText: "Which of the following causes classically produces eggshell calcification of hilar lymph nodes?",
      options: JSON.stringify(["Tuberculosis", "Silicosis", "Hodgkin lymphoma post-treatment", "Metastatic thyroid cancer"]),
      correctAnswer: 1,
      explanation: "Eggshell calcification (thin peripheral rim of calcification) of hilar lymph nodes is classically associated with silicosis. It can also be seen in sarcoidosis, post-radiation therapy for Hodgkin lymphoma, and rarely in coal worker's pneumoconiosis. TB typically causes dense, irregular calcification rather than eggshell pattern.",
      difficulty: "medium",
      category: "Lymph Node Calcification",
    },
    {
      questionText: "A 60-year-old smoker presents with hemoptysis. CXR shows right upper lobe collapse with a convex lateral border of the collapsed lobe. What is the name of this sign and what does it suggest?",
      options: JSON.stringify(["Hampton hump - pulmonary embolism", "Golden S sign - central obstructing mass", "Luftsichel sign - left upper lobe collapse", "Deep sulcus sign - pneumothorax"]),
      correctAnswer: 1,
      explanation: "The Golden S sign (reverse S sign of Golden) is seen with right upper lobe collapse caused by a central obstructing mass (typically bronchogenic carcinoma). The 'S' shape is formed by the minor fissure being displaced upward centrally (by the mass) while the lateral portion is displaced downward (by the collapsed lobe). This is a high-yield sign for board exams.",
      difficulty: "hard",
      category: "Lung Collapse",
    },
    {
      questionText: "What is the most common cause of a solitary cavitary lung lesion with a thick irregular wall in a 55-year-old smoker?",
      options: JSON.stringify(["Lung abscess", "Squamous cell carcinoma", "Tuberculosis", "Wegener granulomatosis (GPA)"]),
      correctAnswer: 1,
      explanation: "In a 55-year-old smoker, a thick-walled cavitary lesion is most likely squamous cell carcinoma of the lung. Squamous cell carcinoma is the most common primary lung cancer to cavitate. Wall thickness >15mm suggests malignancy. Thin-walled cavities (<4mm) are more likely benign. Other causes include abscess, TB, and GPA, but the clinical context (age, smoking) makes cancer most likely.",
      difficulty: "medium",
      category: "Cavitary Lesions",
    },
    {
      questionText: "On a chest X-ray, the cardiac silhouette is considered enlarged when the cardiothoracic ratio exceeds:",
      options: JSON.stringify(["0.4", "0.5", "0.6", "0.55"]),
      correctAnswer: 1,
      explanation: "The cardiothoracic ratio (CTR) is the ratio of the maximum cardiac diameter to the maximum thoracic diameter on a PA chest X-ray. A CTR >0.5 (50%) indicates cardiomegaly. Important: this measurement is only valid on PA films. AP films magnify the heart and falsely increase the CTR. Neonates can have a CTR up to 0.6 normally.",
      difficulty: "easy",
      category: "Cardiac",
    },
    {
      questionText: "A peripheral wedge-shaped opacity at the right lung base with a rounded convex medial border toward the hilum is most consistent with:",
      options: JSON.stringify(["Pneumonia", "Pulmonary infarction (Hampton hump)", "Lung cancer", "Pleural effusion"]),
      correctAnswer: 1,
      explanation: "Hampton hump is a peripheral wedge-shaped opacity with a rounded convex border facing the hilum, representing pulmonary infarction secondary to pulmonary embolism. It occurs in about 15% of PE cases. The hump represents infarcted lung tissue distal to an occluded pulmonary artery. It is often accompanied by Westermark sign (focal oligemia) and Fleischner sign (enlarged pulmonary artery).",
      difficulty: "hard",
      category: "Pulmonary Embolism",
    },
    {
      questionText: "Which of the following is NOT a typical feature of left upper lobe collapse?",
      options: JSON.stringify(["Veil-like opacity over the left hemithorax", "Luftsichel sign", "Loss of the left heart border", "Elevation of the left hemidiaphragm"]),
      correctAnswer: 3,
      explanation: "Left upper lobe collapse produces: (1) a veil-like opacity over the left hemithorax as the collapsed lobe falls anteriorly and medially, (2) the Luftsichel sign (crescent of air between the aortic arch and the hyperexpanded superior segment of the left lower lobe), and (3) loss of the left heart border. Elevation of the hemidiaphragm is a feature of lower lobe collapse, not upper lobe collapse.",
      difficulty: "hard",
      category: "Lung Collapse",
    },
    {
      questionText: "Short horizontal lines at the lung periphery in the lower zones, measuring 1-2 cm, most likely represent:",
      options: JSON.stringify(["Kerley A lines", "Kerley B lines", "Kerley C lines", "Tram-track sign"]),
      correctAnswer: 1,
      explanation: "Kerley B lines are short (1-2 cm) horizontal lines at the lung periphery, perpendicular to the pleural surface, most prominent in the lower zones. They represent thickened interlobular septa and are seen in pulmonary edema, lymphangitic carcinomatosis, and sarcoidosis. Kerley A lines are longer (2-6 cm) oblique lines in the upper zones. Tram-track sign refers to parallel lines of bronchial wall thickening in bronchiectasis.",
      difficulty: "easy",
      category: "Interstitial Pattern",
    },
  ];

  for (const q of ch1Questions) {
    await prisma.question.create({
      data: { ...q, chapterId: ch1.id },
    });
  }

  // Flashcards for Chapter 1
  const ch1Flashcards = [
    { front: "What is the silhouette sign?", back: "Loss of a normal anatomical border when adjacent structures have the same density. Used to localize pathology in the chest.", category: "Signs" },
    { front: "Loss of right heart border on CXR suggests pathology in which lobe?", back: "Right middle lobe (the right heart border is formed by the right atrium, which is in contact with the RML)", category: "Silhouette Sign" },
    { front: "Loss of left heart border on CXR suggests pathology in which structure?", back: "Lingula (the left heart border is formed by the left ventricle, in contact with the lingula)", category: "Silhouette Sign" },
    { front: "What is the Deep Sulcus Sign?", back: "Abnormally deep, lucent costophrenic angle on supine chest X-ray. Most reliable sign of pneumothorax on supine films.", category: "Pneumothorax" },
    { front: "What is the Golden S Sign?", back: "Reverse S-shaped curve of the minor fissure in right upper lobe collapse. The central convexity is caused by a hilar mass (typically bronchogenic carcinoma).", category: "Signs" },
    { front: "What is Hampton Hump?", back: "Peripheral wedge-shaped opacity with a convex medial border, representing pulmonary infarction (seen in ~15% of PE cases).", category: "Pulmonary Embolism" },
    { front: "What is Westermark Sign?", back: "Focal area of oligemia (reduced blood flow/vascular markings) distal to a pulmonary embolus.", category: "Pulmonary Embolism" },
    { front: "What is the Luftsichel Sign?", back: "Crescent of air between the aortic arch and the hyperexpanded superior segment of the left lower lobe, seen in left upper lobe collapse.", category: "Signs" },
    { front: "What is the normal cardiothoracic ratio (CTR) on PA CXR?", back: "CTR should be ≤ 0.5 (50%). CTR > 0.5 = cardiomegaly. Only valid on PA films (AP magnifies the heart).", category: "Cardiac" },
    { front: "Name the classic triad of Löfgren syndrome", back: "1. Bilateral hilar lymphadenopathy, 2. Erythema nodosum, 3. Polyarthralgia (especially ankles). Acute form of sarcoidosis with excellent prognosis (>90% resolution).", category: "Sarcoidosis" },
    { front: "What causes eggshell calcification of hilar lymph nodes?", back: "Silicosis (most classic), sarcoidosis, post-radiation therapy for Hodgkin lymphoma, coal worker's pneumoconiosis.", category: "Calcification" },
    { front: "What does a miliary pattern on CXR look like and what are the main causes?", back: "Innumerable 1-3mm nodules uniformly distributed throughout both lungs. Main causes: TB, fungal infection, metastases (thyroid, melanoma, renal).", category: "Patterns" },
    { front: "What are Kerley B lines?", back: "Short (1-2 cm) horizontal lines at lung periphery in lower zones, perpendicular to pleural surface. They represent thickened interlobular septa. Causes: pulmonary edema, lymphangitic carcinomatosis, sarcoidosis.", category: "Interstitial Pattern" },
    { front: "List causes of unilateral hilar enlargement", back: "Lung cancer (most common), lymphoma, pulmonary artery aneurysm, sarcoidosis (usually bilateral), TB/infection", category: "Hilum" },
    { front: "What is an air bronchogram and what does it indicate?", back: "Air-filled bronchi visible within opacified lung tissue. Indicates airspace disease (consolidation). The surrounding alveoli are filled with fluid/cells while the bronchi remain patent.", category: "Signs" },
  ];

  for (const f of ch1Flashcards) {
    await prisma.flashcard.create({
      data: { ...f, chapterId: ch1.id },
    });
  }

  // Chapter 2: Neuroradiology (Core Radiology)
  const ch2 = await prisma.chapter.upsert({
    where: { bookSource_number: { bookSource: "core_radiology", number: 2 } },
    update: {},
    create: {
      bookSource: "core_radiology",
      number: 2,
      title: "Neuroradiology",
      summary: `Neuroradiology encompasses imaging of the brain, spine, and head/neck. CT and MRI are the primary modalities, with CT being the first-line study for acute presentations (stroke, trauma, hemorrhage) and MRI providing superior soft tissue contrast for tumors, infection, and demyelination.

The approach to brain CT starts with identifying the grey-white matter differentiation, evaluating the ventricles and sulci, checking for mass effect/midline shift, and looking for hemorrhage. On MRI, T1-weighted images provide excellent anatomy (fat is bright, CSF is dark), while T2-weighted images highlight pathology (fluid/edema is bright). FLAIR suppresses CSF signal, making periventricular and cortical lesions more conspicuous.

Stroke imaging is a critical component: CT is performed first to rule out hemorrhage. CT angiography identifies large vessel occlusion. CT perfusion or MRI DWI/PWI helps determine the ischemic penumbra. DWI (diffusion-weighted imaging) shows cytotoxic edema within minutes of arterial occlusion, making it the most sensitive sequence for acute ischemic stroke.`,
      keyPoints: JSON.stringify([
        "CT is first-line for acute brain: stroke, trauma, hemorrhage (fast, widely available, sensitive for blood)",
        "MRI provides superior soft tissue contrast: tumors, MS, infection, posterior fossa lesions",
        "T1: anatomy (fat bright, CSF dark, grey matter darker than white matter)",
        "T2: pathology (fluid/edema bright, CSF bright)",
        "FLAIR: T2 with CSF suppressed - highlights periventricular and cortical lesions",
        "DWI shows restricted diffusion (bright on DWI, dark on ADC map) = cytotoxic edema (acute stroke, abscess, epidermoid)",
        "Acute blood is hyperdense on CT (60-80 HU), becomes isodense at 1-2 weeks, hypodense after",
        "MCA territory stroke: insular ribbon sign (loss of grey-white differentiation at insula) is early CT sign",
        "Berry aneurysms: most common at anterior communicating artery (ACoA), then PCoA, then MCA bifurcation",
        "Epidural hematoma: biconvex/lenticular, doesn't cross sutures, associated with middle meningeal artery",
        "Subdural hematoma: crescent-shaped, crosses sutures, associated with bridging vein tears"
      ]),
      highYield: JSON.stringify([
        "DWI restriction (bright DWI + dark ADC) = acute stroke within minutes. Most sensitive early sequence.",
        "Epidural = biconvex, doesn't cross sutures. Subdural = crescent, crosses sutures. Remember: Epidural is under pressure.",
        "Empty delta sign on contrast CT = dural venous sinus thrombosis",
        "Ring-enhancing lesions: abscess (complete ring, restricted diffusion), tumor (incomplete ring, no restriction), toxoplasmosis in HIV",
        "Chiari I: cerebellar tonsils >5mm below foramen magnum. Chiari II: myelomeningocele + small posterior fossa + towering cerebellum"
      ]),
      mnemonics: JSON.stringify([
        {
          name: "CT density of blood over time: ID BIB",
          content: "Immediately Dense (acute = hyperdense 60-80 HU), Becomes Isodense (1-2 weeks), finally Becomes dark/hypodense (chronic). Remember: fresh blood is bright on CT!"
        },
        {
          name: "Ring-enhancing brain lesions: MAGIC DR",
          content: "M = Metastasis, A = Abscess, G = Glioblastoma (GBM), I = Infarct (subacute), C = Contusion, D = Demyelination (tumefactive MS), R = Radiation necrosis"
        },
        {
          name: "MRI bright on T1 (without contrast): FaMPBaG",
          content: "F = Fat, M = Melanin (melanoma mets), P = Protein (colloid cyst), B = Blood (methemoglobin - subacute), G = Gadolinium. Also: manganese, calcification (sometimes)"
        }
      ]),
      memoryPalace: `Walking through a HOSPITAL EMERGENCY DEPARTMENT for Neuroradiology:

STATION 1 - AMBULANCE BAY (Acute Stroke): A clock on the wall shows time ticking. A DWI scanner glows bright - it catches strokes within MINUTES. The insular ribbon on a gift box is fading (insular ribbon sign = early loss of grey-white differentiation).

STATION 2 - TRAUMA BAY (Hemorrhage): Two beds side by side. Left bed: a LENS-shaped (biconvex) blood collection sitting between the skull sutures, unable to cross them (epidural). Right bed: a CRESCENT moon-shaped collection draped across multiple sutures (subdural).

STATION 3 - CT SCANNER ROOM (Blood Evolution): A traffic light changes color: GREEN/bright (acute, hyperdense), YELLOW (1-2 weeks, isodense), RED/dark (chronic, hypodense). ID BIB!

STATION 4 - MRI SUITE (Sequences): Room painted in two halves. T1 side: a skeleton showing anatomy, fat glowing white, water/CSF dark. T2 side: everything pathological glows bright like neon, water is bright. A FLAIR mop is used to "wipe away" the CSF signal.`
    },
  });

  const ch2Questions = [
    {
      questionText: "A 70-year-old presents with acute onset left-sided weakness 1 hour ago. Non-contrast CT head is normal. What is the most sensitive next imaging step?",
      options: JSON.stringify(["Contrast-enhanced CT", "MRI DWI (diffusion-weighted imaging)", "CT angiography", "MRI T2 FLAIR"]),
      correctAnswer: 1,
      explanation: "MRI DWI is the most sensitive sequence for detecting acute ischemic stroke, showing restricted diffusion (cytotoxic edema) within minutes of onset. Non-contrast CT may be normal in the first 6-12 hours. While CTA is important for identifying large vessel occlusion, DWI directly identifies the infarcted tissue.",
      difficulty: "medium",
      category: "Stroke",
    },
    {
      questionText: "On CT, an epidural hematoma is characteristically:",
      options: JSON.stringify(["Crescent-shaped, crosses suture lines", "Biconvex/lenticular, does not cross suture lines", "Diffuse sulcal hyperdensity", "Hypodense extra-axial collection"]),
      correctAnswer: 1,
      explanation: "Epidural hematomas are biconvex (lenticular) in shape and do NOT cross suture lines because the dura is tightly adherent to the inner table at suture lines. They are most commonly caused by rupture of the middle meningeal artery (temporal bone fracture). Subdural hematomas are crescent-shaped and DO cross suture lines.",
      difficulty: "easy",
      category: "Trauma",
    },
    {
      questionText: "Which of the following structures is most commonly the site of berry aneurysms?",
      options: JSON.stringify(["Basilar artery tip", "Anterior communicating artery", "Posterior inferior cerebellar artery", "Middle cerebral artery trifurcation"]),
      correctAnswer: 1,
      explanation: "The anterior communicating artery (ACoA) is the most common location for berry aneurysms (~30-35%), followed by the posterior communicating artery (PCoA ~25%), and the MCA bifurcation (~20%). Berry aneurysms arise at branching points due to gaps in the tunica media. They are the most common cause of non-traumatic subarachnoid hemorrhage.",
      difficulty: "medium",
      category: "Vascular",
    },
    {
      questionText: "What does the 'empty delta sign' on contrast-enhanced CT indicate?",
      options: JSON.stringify(["Epidural hematoma", "Dural venous sinus thrombosis", "Meningioma", "Arachnoid cyst"]),
      correctAnswer: 1,
      explanation: "The empty delta sign (empty triangle sign) is seen on contrast-enhanced CT as a triangular area of enhancement surrounding a central low-density filling defect in the dural venous sinus, representing thrombus. The enhancing rim is the dural walls of the sinus with collateral flow. This sign is highly specific for cerebral venous sinus thrombosis.",
      difficulty: "hard",
      category: "Venous Thrombosis",
    },
    {
      questionText: "On MRI, which substance is characteristically hyperintense on T1-weighted images WITHOUT contrast?",
      options: JSON.stringify(["Acute hemorrhage (deoxyhemoglobin)", "CSF", "Methemoglobin (subacute blood)", "Calcification"]),
      correctAnswer: 2,
      explanation: "Methemoglobin (found in subacute hemorrhage, both early and late subacute phases) is hyperintense on T1-weighted images due to its paramagnetic properties. The mnemonic FaMPBaG: Fat, Melanin, Protein, Blood (methemoglobin), and Gadolinium are all T1 bright. Acute blood (deoxyhemoglobin) is T1 isointense. CSF is T1 dark.",
      difficulty: "medium",
      category: "MRI Signal Characteristics",
    },
    {
      questionText: "A brain MRI shows a ring-enhancing lesion with restricted diffusion in the center. The most likely diagnosis is:",
      options: JSON.stringify(["Glioblastoma multiforme", "Brain abscess", "Metastasis", "Toxoplasmosis"]),
      correctAnswer: 1,
      explanation: "A ring-enhancing lesion with restricted diffusion (bright on DWI, dark on ADC) in the center is characteristic of a brain abscess. The restricted diffusion reflects the viscous purulent content. GBM and metastases show ring enhancement but typically do NOT show central restricted diffusion (their necrotic centers show facilitated diffusion). This is a key differentiating feature.",
      difficulty: "hard",
      category: "Ring Enhancement",
    },
  ];

  for (const q of ch2Questions) {
    await prisma.question.create({
      data: { ...q, chapterId: ch2.id },
    });
  }

  const ch2Flashcards = [
    { front: "What is the earliest CT sign of MCA territory ischemic stroke?", back: "Insular ribbon sign (loss of grey-white matter differentiation at the insular cortex), followed by obscuration of the lentiform nucleus, sulcal effacement, and loss of cortical grey-white differentiation.", category: "Stroke" },
    { front: "What does restricted diffusion on MRI mean? (DWI/ADC)", back: "Bright on DWI + dark on ADC = restricted diffusion = reduced water molecule movement. Seen in: cytotoxic edema (acute stroke), abscess (viscous pus), epidermoid cyst, highly cellular tumors (lymphoma).", category: "MRI Physics" },
    { front: "Epidural vs Subdural hematoma - key differences", back: "Epidural: biconvex, doesn't cross sutures, middle meningeal artery, lucid interval. Subdural: crescent, crosses sutures, bridging veins, elderly/anticoagulated/shaken baby.", category: "Trauma" },
    { front: "What is the empty delta sign?", back: "Triangular filling defect on contrast CT within a dural venous sinus, surrounded by enhancement. Diagnostic of cerebral venous sinus thrombosis.", category: "Venous" },
    { front: "Most common location for berry aneurysms?", back: "1. Anterior communicating artery (ACoA) ~30-35%, 2. Posterior communicating artery (PCoA) ~25%, 3. MCA bifurcation ~20%. Arise at branching points due to tunica media gaps.", category: "Vascular" },
    { front: "What is T1 bright on MRI? (mnemonic: FaMPBaG)", back: "Fat, Melanin (melanoma), Protein (colloid cyst), Blood (methemoglobin - subacute), Gadolinium contrast. Also manganese, lipid in dermoid.", category: "MRI Signal" },
    { front: "FLAIR sequence - what does it do and when is it useful?", back: "Fluid Attenuated Inversion Recovery: T2 with CSF signal suppressed. Makes periventricular lesions (MS plaques), meningitis, and cortical pathology more conspicuous by removing bright CSF signal.", category: "MRI Sequences" },
    { front: "How to differentiate abscess vs tumor ring enhancement?", back: "Abscess: complete smooth ring, restricted diffusion in center (bright DWI), smooth inner wall. Tumor (GBM/met): often incomplete ring, NO restricted diffusion in center, irregular inner wall.", category: "Ring Enhancement" },
    { front: "CT evolution of intracranial hemorrhage over time", back: "Acute (0-3 days): hyperdense 60-80 HU. Subacute (3 days-3 weeks): becomes isodense from periphery inward. Chronic (>3 weeks): hypodense. Mnemonic: ID BIB.", category: "Hemorrhage" },
    { front: "Chiari I vs Chiari II malformation", back: "Chiari I: cerebellar tonsils >5mm below foramen magnum, often isolated, presents in young adults. Chiari II: myelomeningocele + small posterior fossa + towering cerebellum + multiple CNS anomalies, presents in infancy.", category: "Congenital" },
  ];

  for (const f of ch2Flashcards) {
    await prisma.flashcard.create({
      data: { ...f, chapterId: ch2.id },
    });
  }

  // Chapter 3: Musculoskeletal Radiology (Core Radiology)
  const ch3 = await prisma.chapter.upsert({
    where: { bookSource_number: { bookSource: "core_radiology", number: 3 } },
    update: {},
    create: {
      bookSource: "core_radiology",
      number: 3,
      title: "Musculoskeletal Radiology",
      summary: `Musculoskeletal radiology covers imaging of bones, joints, and soft tissues using radiography, CT, MRI, and ultrasound. Radiography remains the first-line investigation for most MSK pathology.

The approach to bone lesions follows the mnemonic: age, location (which bone, where in the bone), margin/transition zone (narrow = benign, wide/permeative = aggressive), periosteal reaction (solid/lamellar = benign, sunburst/onion-skin/Codman triangle = aggressive), matrix (osteoid = cloud-like, chondroid = rings and arcs), and soft tissue mass.

For fractures, understanding the mechanism of injury and pattern recognition is essential. Stress fractures show a characteristic linear low signal on all MRI sequences. Pathologic fractures should be suspected when a fracture occurs through abnormal bone.

Joint imaging focuses on alignment, soft tissue swelling, joint space, erosions, and periarticular changes. MRI is the gold standard for internal derangement of joints, particularly the knee (menisci, cruciate ligaments) and shoulder (rotator cuff, labrum).`,
      keyPoints: JSON.stringify([
        "Bone lesion approach: Age, Location, Margin, Periosteal reaction, Matrix, Soft tissue mass",
        "Narrow transition zone = benign/slow-growing (geographic destruction). Wide/permeative = aggressive (malignant or infection)",
        "Sunburst periosteal reaction: osteosarcoma. Onion-skin: Ewing sarcoma. Codman triangle: aggressive lesion lifting periosteum",
        "Chondroid matrix = rings and arcs (popcorn calcification). Osteoid matrix = cloud-like dense calcification",
        "Most common primary malignant bone tumor in children: osteosarcoma (metaphysis of long bones, knee region)",
        "Most common primary malignant bone tumor in adults: myeloma (punched-out lytic lesions, no sclerotic rim)",
        "Ewing sarcoma: diaphysis of long bones in children 5-15, permeative destruction, large soft tissue mass",
        "ACL tear on MRI: disrupted fibers, increased signal, secondary signs (bone bruises at lateral femoral condyle + posterolateral tibial plateau)",
        "Meniscal tear: linear signal reaching articular surface on at least 2 consecutive images",
        "Rotator cuff: supraspinatus most commonly torn, best seen on coronal oblique T2"
      ]),
      highYield: JSON.stringify([
        "Location of bone tumors by age: <20 = osteosarcoma/Ewing; 20-40 = GCT (epiphysis), chondrosarcoma; >40 = metastases, myeloma",
        "Sclerotic (blastic) metastases: prostate, breast. Lytic metastases: lung, kidney, thyroid (mnemonic: blastic = Pb for Prostate/Breast)",
        "Giant cell tumor (GCT): epiphyseal, eccentric, well-defined lytic, subarticular, 20-40 years, most common around knee",
        "Bucket handle tear: displaced fragment of meniscus into intercondylar notch, double PCL sign",
        "Avascular necrosis (AVN): causes = ASEPTIC (Alcohol/Steroids/Sickle cell/Pancreatitis/Trauma/Idiopathic/Caisson disease)"
      ]),
      mnemonics: JSON.stringify([
        {
          name: "FEGNOMASHIC - benign bone lesions",
          content: "Fibrous dysplasia, Enchondroma, Giant cell tumor, Non-ossifying fibroma, Osteoblastoma, Metastasis (also malignant), Aneurysmal bone cyst, Simple (unicameral) bone cyst, Hyperparathyroidism (brown tumor), Infection, Chondroblastoma"
        },
        {
          name: "Aggressive periosteal reactions: SOCS",
          content: "S = Sunburst (osteosarcoma), O = Onion skin (Ewing sarcoma, osteomyelitis), C = Codman triangle (any aggressive lesion), S = Spiculated (perpendicular/hair-on-end)"
        },
        {
          name: "Sclerotic metastases sources: Lead Kettle",
          content: "L = Lymphoma, E = Everyone forgets carcinoid, A = Breast (Adeno), D = Prostate. More simply: Prostate and Breast are the two most common sources of blastic mets"
        }
      ]),
      memoryPalace: ""
    },
  });

  const ch3Questions = [
    {
      questionText: "A 15-year-old presents with knee pain. X-ray shows an aggressive periosteal reaction with a 'sunburst' pattern and Codman triangle at the distal femoral metaphysis. What is the most likely diagnosis?",
      options: JSON.stringify(["Ewing sarcoma", "Osteosarcoma", "Osteomyelitis", "Osteochondroma"]),
      correctAnswer: 1,
      explanation: "Osteosarcoma is the most common primary malignant bone tumor in children/adolescents. It classically presents in the metaphysis of long bones (distal femur/proximal tibia = knee region). Sunburst periosteal reaction and Codman triangle are hallmarks of aggressive bone lesions, most classically osteosarcoma. Ewing sarcoma favors the diaphysis and shows onion-skin periosteal reaction.",
      difficulty: "medium",
      category: "Bone Tumors",
    },
    {
      questionText: "An eccentric, well-defined lytic lesion in the epiphysis of the distal femur in a 30-year-old is most likely:",
      options: JSON.stringify(["Osteosarcoma", "Enchondroma", "Giant cell tumor", "Chondroblastoma"]),
      correctAnswer: 2,
      explanation: "Giant cell tumor (GCT) is the classic epiphyseal lesion in skeletally mature patients (20-40 years). It is eccentric, lytic with a well-defined but non-sclerotic margin, and extends to the subarticular bone. Most common around the knee (distal femur, proximal tibia). Chondroblastoma is also epiphyseal but occurs in skeletally immature patients (<20).",
      difficulty: "medium",
      category: "Bone Tumors",
    },
    {
      questionText: "Which bone metastases are characteristically sclerotic (osteoblastic)?",
      options: JSON.stringify(["Lung and kidney", "Prostate and breast", "Thyroid and renal", "Hepatocellular and melanoma"]),
      correctAnswer: 1,
      explanation: "Prostate metastases are almost always sclerotic/blastic. Breast metastases can be lytic, blastic, or mixed, but breast is the second most common cause of blastic mets after prostate. Lung, kidney, thyroid, and melanoma typically cause lytic metastases. Remember: 'P and B are Blastic' (Prostate and Breast).",
      difficulty: "easy",
      category: "Metastases",
    },
    {
      questionText: "On MRI of the knee, what is the 'double PCL sign'?",
      options: JSON.stringify(["Two intact PCL ligaments", "A displaced bucket handle meniscal tear fragment in the intercondylar notch", "Bilateral PCL tears", "PCL mucoid degeneration"]),
      correctAnswer: 1,
      explanation: "The 'double PCL sign' refers to a displaced fragment from a bucket handle meniscal tear lying in the intercondylar notch, parallel to the PCL, mimicking a second PCL on sagittal MRI images. This is a classic finding of a displaced meniscal tear and should prompt careful evaluation of the menisci.",
      difficulty: "hard",
      category: "Knee MRI",
    },
    {
      questionText: "A 12-year-old with a permeative diaphyseal bone lesion, large soft tissue mass, and onion-skin periosteal reaction. Most likely diagnosis?",
      options: JSON.stringify(["Osteosarcoma", "Ewing sarcoma", "Lymphoma of bone", "Osteomyelitis"]),
      correctAnswer: 1,
      explanation: "Ewing sarcoma classically presents in the diaphysis of long bones in children aged 5-15 years. The triad of permeative destruction, onion-skin (lamellated) periosteal reaction, and a disproportionately large soft tissue mass is characteristic. Osteosarcoma favors the metaphysis and shows sunburst periosteal reaction. Osteomyelitis can mimic Ewing but usually has clinical signs of infection.",
      difficulty: "medium",
      category: "Bone Tumors",
    },
  ];

  for (const q of ch3Questions) {
    await prisma.question.create({
      data: { ...q, chapterId: ch3.id },
    });
  }

  const ch3Flashcards = [
    { front: "Approach to a bone lesion on X-ray (systematic)", back: "Age, Location (which bone + where: epiphysis/metaphysis/diaphysis), Margin (narrow vs wide transition zone), Periosteal reaction, Matrix (osteoid vs chondroid), Soft tissue mass", category: "Approach" },
    { front: "Sunburst periosteal reaction - most common cause?", back: "Osteosarcoma. Also seen in other aggressive lesions. The sunburst pattern represents tumor growing through the cortex with radiating spicules of new bone.", category: "Periosteal Reaction" },
    { front: "Onion-skin periosteal reaction - classic association?", back: "Ewing sarcoma (also osteomyelitis, sometimes osteosarcoma). Represents repeated cycles of periosteal elevation and new bone formation.", category: "Periosteal Reaction" },
    { front: "Where do osteosarcomas most commonly occur?", back: "Metaphysis of long bones around the knee (distal femur > proximal tibia). Peak age 10-20 years. Most common primary malignant bone tumor in children.", category: "Bone Tumors" },
    { front: "Where do Ewing sarcomas most commonly occur?", back: "Diaphysis of long bones (can be flat bones). Age 5-15 years. Second most common primary malignant bone tumor in children. Permeative destruction + large soft tissue mass.", category: "Bone Tumors" },
    { front: "Giant cell tumor (GCT) - key features", back: "Epiphyseal (subarticular), eccentric, lytic, non-sclerotic margin, 20-40 years, most common around knee. Extends to subchondral bone.", category: "Bone Tumors" },
    { front: "Chondroid matrix vs Osteoid matrix on X-ray", back: "Chondroid = rings and arcs (popcorn) calcification. Osteoid = cloud-like, amorphous dense calcification. Helps identify tumor origin.", category: "Matrix" },
    { front: "ACL tear - secondary MRI signs", back: "Bone bruise pattern: lateral femoral condyle + posterolateral tibial plateau (kissing contusion). Anterior tibial translation. PCL buckling. Deepened lateral femoral notch.", category: "Knee MRI" },
  ];

  for (const f of ch3Flashcards) {
    await prisma.flashcard.create({
      data: { ...f, chapterId: ch3.id },
    });
  }

  // Chapter 1 from Crack the Core
  const ch4 = await prisma.chapter.upsert({
    where: { bookSource_number: { bookSource: "crack_the_core", number: 1 } },
    update: {},
    create: {
      bookSource: "crack_the_core",
      number: 1,
      title: "Gastrointestinal Radiology",
      summary: `Gastrointestinal radiology encompasses imaging of the GI tract from esophagus to rectum, as well as the solid abdominal organs (liver, pancreas, spleen). CT abdomen/pelvis is the workhorse modality, with MRI used for liver characterization, pancreatic evaluation, and perianal pathology. Fluoroscopy is used for dynamic swallowing studies and contrast enemas.

Key topics include appendicitis (most common surgical emergency), bowel obstruction (small vs large bowel), and liver lesion characterization. Focal liver lesions follow a systematic approach: determine if the lesion is cystic or solid, check enhancement pattern, and correlate with clinical history.

Hepatocellular carcinoma (HCC) has a pathognomonic enhancement pattern: arterial phase hyperenhancement with portal venous/delayed phase washout and pseudocapsule. This pattern in a cirrhotic liver is diagnostic per LI-RADS criteria without need for biopsy.`,
      keyPoints: JSON.stringify([
        "Appendicitis: dilated appendix >6mm, periappendiceal fat stranding, appendicolith (30%)",
        "Small bowel obstruction (SBO): dilated small bowel >3cm, decompressed colon, transition point. Most common cause: adhesions",
        "Large bowel obstruction (LBO): dilated colon >6cm (>9cm cecum = risk of perforation). Most common cause: colorectal cancer",
        "Coffee bean sign: sigmoid volvulus. Bird beak sign: at point of twist",
        "HCC: arterial enhancement + washout + pseudocapsule in cirrhotic liver = diagnostic (LI-RADS 5)",
        "FNH (focal nodular hyperplasia): central scar with delayed enhancement, no washout, young women",
        "Hemangioma: peripheral nodular enhancement with centripetal fill-in (progressive)",
        "Crohn vs UC: Crohn = transmural, skip lesions, terminal ileum, fistulae. UC = mucosal, continuous, starts at rectum",
        "Pneumatosis intestinalis: gas in bowel wall. Ominous in setting of bowel ischemia, benign if asymptomatic",
        "Target sign in intussusception: bowel-within-bowel on CT cross-section"
      ]),
      highYield: JSON.stringify([
        "SBO transition point: identify the exact level where dilated bowel meets decompressed bowel - this is where the obstruction is",
        "Toxic megacolon: transverse colon >6cm in colitis (usually UC) - risk of perforation, surgical emergency",
        "Closed-loop obstruction: two transition points, suggests strangulation, surgical emergency",
        "Portal venous gas vs pneumobilia: portal gas extends to liver periphery (follows blood flow), pneumobilia is central (follows bile flow)",
        "Riggler sign: both sides of bowel wall visible = pneumoperitoneum"
      ]),
      mnemonics: JSON.stringify([
        {
          name: "SBO vs LBO - Rule of 3-6-9",
          content: "Small bowel >3cm = dilated. Large bowel >6cm = dilated. Cecum >9cm = risk of perforation. These thresholds help quickly determine if bowel is abnormally dilated."
        },
        {
          name: "Liver lesion enhancement: HCC vs FNH vs Hemangioma",
          content: "HCC: Wash-IN then Wash-OUT (arterial hyper, portal washout). FNH: Star-shaped scar (central scar with delayed enhancement). Hemangioma: Slow-Fill (peripheral nodular, progressive centripetal fill-in)."
        },
        {
          name: "Crohn disease features: CROHNS",
          content: "C = Cobblestoning, R = Regional (skip lesions), O = Obstruction/strictures, H = Holes (fistulae), N = Noncaseating granulomas, S = String sign (terminal ileum narrowing)"
        }
      ]),
      memoryPalace: ""
    },
  });

  const ch4Questions = [
    {
      questionText: "Which enhancement pattern is diagnostic of hepatocellular carcinoma in a cirrhotic liver?",
      options: JSON.stringify(["Peripheral nodular enhancement with centripetal fill-in", "Arterial hyperenhancement with portal venous washout", "Homogeneous enhancement without washout", "Central scar with delayed enhancement"]),
      correctAnswer: 1,
      explanation: "HCC shows arterial phase hyperenhancement (due to hepatic arterial supply) followed by washout in the portal venous or delayed phase, often with a pseudocapsule. In a cirrhotic liver, this pattern is diagnostic (LI-RADS 5) and biopsy is not required. Peripheral nodular enhancement = hemangioma. Central scar = FNH.",
      difficulty: "medium",
      category: "Liver",
    },
    {
      questionText: "A 25-year-old woman presents with an incidentally found liver lesion. MRI shows a homogeneous mass with a central scar that enhances on delayed phase. The most likely diagnosis is:",
      options: JSON.stringify(["Hepatic adenoma", "Focal nodular hyperplasia (FNH)", "Hepatocellular carcinoma", "Hemangioma"]),
      correctAnswer: 1,
      explanation: "FNH classically presents as a well-circumscribed liver mass in a young woman, with a characteristic central scar that enhances on delayed phase. FNH is the second most common benign liver tumor. It is composed of normal hepatocytes with a central stellate scar containing abnormal vasculature. No malignant potential and usually managed conservatively.",
      difficulty: "medium",
      category: "Liver",
    },
    {
      questionText: "What is the most common cause of small bowel obstruction in adults?",
      options: JSON.stringify(["Hernia", "Adhesions", "Crohn disease", "Gallstone ileus"]),
      correctAnswer: 1,
      explanation: "Adhesions (usually from prior surgery) are the most common cause of small bowel obstruction in adults, accounting for ~60-75% of cases. Hernias are the second most common cause. In patients with no prior surgery, the differential shifts toward hernias, Crohn disease, and tumors.",
      difficulty: "easy",
      category: "Bowel Obstruction",
    },
    {
      questionText: "On CT, the 'coffee bean sign' is characteristic of:",
      options: JSON.stringify(["Cecal volvulus", "Sigmoid volvulus", "Closed-loop obstruction", "Intussusception"]),
      correctAnswer: 1,
      explanation: "The coffee bean sign is the classic radiographic finding of sigmoid volvulus, representing the dilated, twisted sigmoid colon loop projecting from the pelvis toward the right upper quadrant. The central cleft represents the mesenteric fold between the two limbs of the twisted loop. Sigmoid volvulus accounts for ~60-75% of colonic volvulus.",
      difficulty: "easy",
      category: "Volvulus",
    },
    {
      questionText: "On CT, portal venous gas differs from pneumobilia because portal gas:",
      options: JSON.stringify(["Is central in the liver", "Extends to the liver periphery", "Is always pathological", "Is confined to the left lobe"]),
      correctAnswer: 1,
      explanation: "Portal venous gas extends to the liver periphery (within 2 cm of the liver capsule) because it follows blood flow direction in the portal system (centrifugal). Pneumobilia (gas in the biliary system) is central because bile flows centripetally toward the hilum. Portal venous gas is often ominous (bowel ischemia) but can be benign (post-procedure).",
      difficulty: "medium",
      category: "Abdominal Signs",
    },
  ];

  for (const q of ch4Questions) {
    await prisma.question.create({
      data: { ...q, chapterId: ch4.id },
    });
  }

  const ch4Flashcards = [
    { front: "Rule of 3-6-9 for bowel dilation", back: "Small bowel >3cm = dilated. Large bowel >6cm = dilated. Cecum >9cm = risk of perforation.", category: "Bowel Obstruction" },
    { front: "HCC enhancement pattern", back: "Arterial phase hyperenhancement + portal venous/delayed washout + pseudocapsule. In cirrhotic liver = LI-RADS 5 (diagnostic, no biopsy needed).", category: "Liver" },
    { front: "FNH (Focal Nodular Hyperplasia) key features", back: "Young women, well-circumscribed, central stellate scar with DELAYED enhancement, no washout, no malignant potential. Second most common benign liver tumor.", category: "Liver" },
    { front: "Hemangioma enhancement pattern", back: "Peripheral NODULAR enhancement with progressive centripetal fill-in on delayed phases. Most common benign liver tumor. T2 bright (light bulb sign).", category: "Liver" },
    { front: "Portal venous gas vs pneumobilia location", back: "Portal gas = peripheral (follows centrifugal blood flow, within 2cm of capsule). Pneumobilia = central (follows centripetal bile flow toward hilum).", category: "Abdominal Signs" },
    { front: "Most common cause of SBO in adults?", back: "Adhesions (~60-75%), usually from prior surgery. Second: hernias.", category: "Bowel Obstruction" },
    { front: "Coffee bean sign - what is it?", back: "Sigmoid volvulus: dilated, twisted sigmoid loop projecting from pelvis toward RUQ with central cleft representing mesenteric fold.", category: "Volvulus" },
    { front: "Crohn vs UC key differences (CROHNS mnemonic)", back: "Crohn: transmural, skip lesions, terminal ileum, fistulae, cobblestoning, strictures, granulomas. UC: mucosal only, continuous, starts at rectum, no fistulae, backwash ileitis, toxic megacolon risk.", category: "IBD" },
    { front: "Appendicitis CT criteria", back: "Dilated appendix >6mm diameter, periappendiceal fat stranding, +/- appendicolith (30%), +/- free fluid. Sensitivity of CT >95%.", category: "Acute Abdomen" },
    { front: "Target sign on CT - what does it indicate?", back: "Bowel-within-bowel appearance on CT cross-section = intussusception. In adults, most cases have a lead point (tumor, polyp).", category: "Bowel" },
  ];

  for (const f of ch4Flashcards) {
    await prisma.flashcard.create({
      data: { ...f, chapterId: ch4.id },
    });
  }

  console.log("Seeding complete!");
  console.log("Created 4 chapters with questions and flashcards:");
  console.log("  - Core Radiology Ch.1: Chest Radiology");
  console.log("  - Core Radiology Ch.2: Neuroradiology");
  console.log("  - Core Radiology Ch.3: Musculoskeletal Radiology");
  console.log("  - Crack the Core Ch.1: Gastrointestinal Radiology");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
