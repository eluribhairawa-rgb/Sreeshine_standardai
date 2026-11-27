#!/usr/bin/env python3
"""Seed result parameters (units + reference ranges, with separate Male / Female rows where the
reference interval differs by sex) for the tests already in diag_services.

Additive and idempotent -- it never deletes or edits an existing parameter, service, order or report:
  * a service that already has parameters is skipped;
  * --force still never removes or changes anything: it only ADDS template parameters that the service
    does not have yet (matched by parameter name + sex);
  * a test with no template (and no safe generic rule) is listed and left alone -- ranges are never invented.
Sex-specific analytes get one 'M' row and one 'F' row with the same name; result entry then offers only the
row matching the patient's sex (see parameters_for_patient_sex in legacy_queries.py).
Uses the app's own connection (database.SessionLocal -> DATABASE_URL), i.e. the existing database / container.

Usage (from the backend folder):
    python seed_swecha_catalogue_parameters.py --dry-run
    python seed_swecha_catalogue_parameters.py
    python seed_swecha_catalogue_parameters.py --force --dry-run     # also top up services that already have parameters
"""
import argparse
import re
import sys

N, T, Q = "numeric", "text", "qualitative"


def normalise(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(name or "").lower()).strip()


# ---- parameter builders: (name, data_type, unit, sex, ref_low, ref_high, ref_text) ----------------
def num(name, unit=None, low=None, high=None, text=None):
    return [(name, N, unit, None, low, high, text)]


def by_sex(name, unit, m, f):
    """Separate M and F rows. m / f = (low, high, text); None = no row for that sex."""
    rows = []
    if m is not None:
        rows.append((name, N, unit, "M", m[0], m[1], m[2] if len(m) > 2 else None))
    if f is not None:
        rows.append((name, N, unit, "F", f[0], f[1], f[2] if len(f) > 2 else None))
    return rows


def txt(name, ref=None, unit=None):
    return [(name, T, unit, None, None, None, ref)]


def qual(name, ref):
    return [(name, Q, None, None, None, None, ref)]


def pack(*groups):
    out = []
    for g in groups:
        out.extend(g)
    return out


# ---- reusable analytes -------------------------------------------------------------------------
HB = by_sex("Haemoglobin", "g/dL", (13.0, 17.0), (12.0, 15.0))
RBC = by_sex("RBC Count", "million/cumm", (4.5, 5.5), (3.8, 4.8))
PCV = by_sex("Packed Cell Volume (PCV)", "%", (40, 50), (36, 46))
ESR = by_sex("ESR (Westergren)", "mm/hr", (0, 15), (0, 20))
CREAT = by_sex("Serum Creatinine", "mg/dL", (0.7, 1.3), (0.6, 1.1))
URIC = by_sex("Uric Acid", "mg/dL", (3.5, 7.2), (2.6, 6.0))
IRON = by_sex("Serum Iron", "ug/dL", (65, 175), (50, 170))
FERRITIN = by_sex("Ferritin", "ng/mL", (24, 336), (11, 307))
TSAT = by_sex("Transferrin Saturation", "%", (20, 50), (15, 50))
HDL = by_sex("HDL Cholesterol", "mg/dL", (40, None, "> 40"), (50, None, "> 50"))
GGT = by_sex("GGT", "U/L", (8, 61), (5, 36))
CPK = by_sex("CPK (Total)", "U/L", (39, 308), (26, 192))
TIBC = num("Total Iron Binding Capacity (TIBC)", "ug/dL", 250, 450)
UREA = num("Urea", "mg/dL", 17, 43)
NA, K, CL = num("Sodium", "mmol/L", 135, 145), num("Potassium", "mmol/L", 3.5, 5.1), num("Chloride", "mmol/L", 98, 107)
DLC = pack(num("Neutrophils", "%", 40, 80), num("Lymphocytes", "%", 20, 40), num("Eosinophils", "%", 1, 6),
           num("Monocytes", "%", 2, 10), num("Basophils", "%", 0, 1))
CBC = pack(HB, num("Total Leucocyte Count", "cells/cumm", 4000, 11000), DLC, num("Platelet Count", "lakh/cumm", 1.5, 4.5), RBC, PCV,
           num("MCV", "fL", 83, 101), num("MCH", "pg", 27, 32), num("MCHC", "g/dL", 31.5, 34.5), num("RDW-CV", "%", 11.6, 14.0),
           txt("Peripheral Smear"))
LFT = pack(num("Total Bilirubin", "mg/dL", 0.2, 1.2), num("Direct Bilirubin", "mg/dL", 0.0, 0.3), num("Indirect Bilirubin", "mg/dL", 0.2, 0.9),
           num("SGOT (AST)", "U/L", 5, 40), num("SGPT (ALT)", "U/L", 5, 40), num("Alkaline Phosphatase (ALP)", "U/L", 44, 147),
           num("Total Protein", "g/dL", 6.0, 8.3), num("Albumin", "g/dL", 3.5, 5.2), num("Globulin", "g/dL", 2.0, 3.5), num("A/G Ratio", None, 1.0, 2.2))
RFT = pack(UREA, num("Blood Urea Nitrogen (BUN)", "mg/dL", 8, 23), CREAT, URIC, NA, K, CL)
LIPID = pack(num("Total Cholesterol", "mg/dL", None, 200, "< 200 (desirable)"), num("Triglycerides", "mg/dL", None, 150, "< 150"), HDL,
             num("LDL Cholesterol", "mg/dL", None, 100, "< 100 (optimal)"), num("VLDL Cholesterol", "mg/dL", 2, 30),
             num("Cholesterol / HDL Ratio", None, None, 5.0, "< 5.0"))
THYROID = pack(num("T3 (Total Triiodothyronine)", "ng/dL", 80, 200), num("T4 (Total Thyroxine)", "ug/dL", 5.1, 14.1),
               num("TSH (Thyroid Stimulating Hormone)", "uIU/mL", 0.27, 4.2))
LH = by_sex("LH (Luteinizing Hormone)", "mIU/mL", (1.7, 8.6), (2.4, 12.6, "Follicular 2.4-12.6; Mid-cycle 14-96; Luteal 1.0-11.4; Post-menopausal 7.7-58.5"))
FSH = by_sex("FSH (Follicle Stimulating Hormone)", "mIU/mL", (1.5, 12.4), (3.5, 12.5, "Follicular 3.5-12.5; Mid-cycle 4.7-21.5; Luteal 1.7-7.7; Post-menopausal 25.8-134.8"))
PRL = by_sex("Prolactin", "ng/mL", (4.0, 15.2), (4.8, 23.3))
GLU_F, GLU_PP = num("Blood Sugar (Fasting)", "mg/dL", 70, 100), num("Blood Sugar (Post Prandial)", "mg/dL", None, 140, "< 140")
RBS = num("Random Blood Sugar", "mg/dL", None, 140, "< 140")
BILI = pack(num("Total Bilirubin", "mg/dL", 0.2, 1.2), num("Direct Bilirubin", "mg/dL", 0.0, 0.3), num("Indirect Bilirubin", "mg/dL", 0.2, 0.9))
NONREACTIVE = qual("Result", "Non-reactive")
NEGATIVE = qual("Result", "Negative")
CULTURE = pack(txt("Organism isolated", "No growth"), txt("Antibiotic sensitivity"), txt("Remarks"))
REPORT = pack(txt("Findings"), txt("Impression"))
CUE = pack(txt("Colour", "Pale yellow"), txt("Appearance", "Clear"), num("Specific Gravity", None, 1.005, 1.030), num("pH", None, 4.6, 8.0),
           txt("Protein (Albumin)", "Nil"), txt("Glucose", "Nil"), txt("Ketones", "Nil"), txt("Bilirubin", "Negative"),
           txt("Urobilinogen", "Normal"), txt("Blood", "Negative"), txt("Nitrite", "Negative"), txt("Pus Cells", "0 - 5", "/HPF"),
           txt("Epithelial Cells", "0 - 4", "/HPF"), txt("RBCs", "Nil", "/HPF"), txt("Casts", "Nil"), txt("Crystals", "Nil"), txt("Bacteria", "Nil"))

TEMPLATES = {}


def add(names, params):
    for n in names if isinstance(names, (list, tuple)) else [names]:
        TEMPLATES[normalise(n)] = params


# Haematology
add(["Complete Blood Count", "Complete Blood Picture(CBP)", "Haemogram"], CBC)
add("Haemoglobin (Hb)", HB)
add("HB%", HB)
add("PCV (Haematocrit)", PCV)
add("Erythrocyte Sedimentation Rate (ESR)", ESR)
add("TLC- Total Leucocytes Count", num("Total Leucocyte Count", "cells/cumm", 4000, 11000))
add("Platelet Count (PL Count)", num("Platelet Count", "lakh/cumm", 1.5, 4.5))
add("DLC- Differential Leucocytes Count", DLC)
add("Absolute Eosinophils Count (AEC)", num("Absolute Eosinophil Count", "cells/cumm", 40, 440))
add("Reticulocyte Count", num("Reticulocyte Count", "%", 0.5, 2.5))
add("Bleeding Time & Clotting Time", pack(num("Bleeding Time", "min", 2, 7), num("Clotting Time", "min", 4, 9)))
add("Blood Group & Rh factor", pack(txt("ABO Blood Group"), txt("Rh Factor")))
add("BLOOD GROUPING", pack(txt("ABO Blood Group"), txt("Rh Factor")))
add(["CD4 Count", "CD4 Absolute Count"], num("CD4 Count", "cells/uL", 500, 1500))
add("Fibrinogen", num("Fibrinogen", "mg/dL", 200, 400))
add("Glucose-6-Phosphate Dehydrogenase", num("G6PD", "U/g Hb", 4.6, 13.5))
add(["PTINR"], pack(num("Prothrombin Time (PT)", "sec", 11, 13.5), num("Control PT", "sec"), num("INR", None, 0.8, 1.2)))
add("PTAPTT", pack(num("Prothrombin Time (PT)", "sec", 11, 13.5), num("INR", None, 0.8, 1.2), num("APTT", "sec", 25, 35)))
add("COAGULATION PROFILE", pack(num("Bleeding Time", "min", 2, 7), num("Clotting Time", "min", 4, 9), num("Prothrombin Time (PT)", "sec", 11, 13.5),
                                num("INR", None, 0.8, 1.2), num("APTT", "sec", 25, 35)))
add("D-Dimer", num("D-Dimer", "ug/mL FEU", None, 0.5, "< 0.5"))
add("HAEMOGLOBIN ELECTROPHORESIS (HPLC)", pack(num("HbA", "%", 96, 98), num("HbA2", "%", 2.0, 3.5), num("HbF", "%", None, 1.0, "< 1.0"), txt("Abnormal variants", "Not detected")))
add(["Malaria Parasite", "Malarial Antigen", "MALARIAL PARASITE (PF/PV)", "SMEAR FOR MALARIAL PARASITE (M.P)", "MP", "Microfilaria Test QBC"], qual("Result", "Not detected"))
add(["Peripheral Blood Smear/ GBP"], pack(txt("RBC morphology"), txt("WBC morphology"), txt("Platelets"), txt("Impression")))
add("Sickling Test", qual("Result", "Negative"))
add(["Direct Coombs Test (DCT)", "Indirect Coomb's Test (ICT)", "ICT"], qual("Result", "Negative"))
add("LE Cells", qual("Result", "Not seen"))
# Biochemistry
add(["BLOOD SUGAR (FASTING)"], GLU_F)
add(["BLOOD SUGAR (PP)", "POST GLUCOSE BLOOD SUGAR (2HRS)"], GLU_PP)
add(["BLOOD SUGAR= RANDOM", "Random Blood Sugar Test (RBS)", "Random Blood Sugar Glucometer (RBS)"], RBS)
add(["BLOOD SUGAR FASTING & PP (BSF & PP)", "FBS & PBLS"], pack(GLU_F, GLU_PP))
add("Oral Glucose Challenge Test (OGCT)", num("Blood Sugar (1 hr after 50 g glucose)", "mg/dL", None, 140, "< 140"))
add("ORAL GLUCOSE TOLERANCE TEST (OGTT)", pack(GLU_F, num("Blood Sugar (1 hr)", "mg/dL", None, 180, "< 180"), num("Blood Sugar (2 hr)", "mg/dL", None, 140, "< 140")))
add("HbA1c / Glycosylated", num("HbA1c", "%", 4.0, 5.6, "Non-diabetic 4.0-5.6; Pre-diabetes 5.7-6.4; Diabetes >= 6.5"))
add("UREA", UREA)
add("UREA & RBS", pack(UREA, RBS))
add(["SERUM CREATININE"], CREAT)
add("SERUM CREATININE & RBS", pack(CREAT, RBS))
add("Serum URIC ACID", URIC)
add("Serum Calcium", num("Serum Calcium", "mg/dL", 8.6, 10.2))
add("Ionic Calcium", num("Ionic Calcium", "mmol/L", 1.12, 1.32))
add("Magnesium", num("Magnesium", "mg/dL", 1.7, 2.2))
add("PHOSPHROUS (PO4)", num("Phosphorus", "mg/dL", 2.5, 4.5))
add("Sodium (Na)", NA)
add("POTASSIUM (K+)", K)
add("Chlorides", CL)
add("IRON", IRON)
add(["Iron Profile Test", "IRON STUDIES"], pack(IRON, TIBC, TSAT))
add("Total Iron Binding Capacity", TIBC)
add("Unsaturated Iron Binding Capacity (UIBC)", num("UIBC", "ug/dL", 111, 343))
add("Transferrin Saturation", TSAT)
add("Serum Transferrin", num("Transferrin", "mg/dL", 200, 360))
add(["Ferritin", "SERUM FERTIN"], FERRITIN)
add("Folic Acid", num("Folic Acid", "ng/mL", 3, 17))
add("VITAMIN B12", num("Vitamin B12", "pg/mL", 200, 900))
add(["25 Hydroxy (OH) Vit D", "VITAMIN D - TOTAL (25-OH-VIT D)- SERUM", "Vitamin D3 level"], num("25-OH Vitamin D", "ng/mL", 30, 100, "Deficient < 20; Insufficient 20-29; Sufficient 30-100"))
add("COPPER-SERUM", by_sex("Serum Copper", "ug/dL", (70, 140), (80, 155)))
add("Serum Zinc", num("Serum Zinc", "ug/dL", 70, 120))
add(["Cholesterol"], num("Total Cholesterol", "mg/dL", None, 200, "< 200 (desirable)"))
add("HDL Cholesterol", HDL)
add("LDL Cholesterol", num("LDL Cholesterol", "mg/dL", None, 100, "< 100 (optimal)"))
add("Triglycerides", num("Triglycerides", "mg/dL", None, 150, "< 150"))
add("VLDL Cholesterol", num("VLDL Cholesterol", "mg/dL", 2, 30))
add(["LIPID PROFILE", "LIQUID PROFILE"], LIPID)
add("LIVER FUNCTION TEST (LFT)", LFT)
add("Bilirubin- Total, Direct, Indirect", BILI)
add("SGOT (AST)- SERUM", num("SGOT (AST)", "U/L", 5, 40))
add("SGPT(ALT) - SERUM", num("SGPT (ALT)", "U/L", 5, 40))
add("Alkaline phosphatase (ALP)", num("Alkaline Phosphatase (ALP)", "U/L", 44, 147))
add("Gamma Glutamyl Transferase - GGT/GGTP", GGT)
add("Serum Total Protein", num("Total Protein", "g/dL", 6.0, 8.3))
add("Globulin", num("Globulin", "g/dL", 2.0, 3.5))
add("RENAL FUNCTION TESTS (RFT)", RFT)
add(["ELECTROLYTES", "Electrolytes Panel"], pack(NA, K, CL))
add("Sodium Potassium (Na,K)", pack(NA, K))
add("Amylase", num("Amylase", "U/L", 28, 100))
add("SERUM AMYLASE", num("Amylase", "U/L", 28, 100))
add("Lipase", num("Lipase", "U/L", 13, 60))
add(["Lactate Dehydrogenase- Serum (LDH)", "LDH"], num("LDH", "U/L", 140, 280))
add(["Creatine Phosphokinase (CPK)"], CPK)
add("CPK MB", num("CPK-MB", "U/L", None, 25, "< 25"))
add(["C- Reactive Protein (CRP) Quantitative", "Blood for CRP"], num("C-Reactive Protein (CRP)", "mg/L", None, 6, "< 6"))
add("C- Reactive Protein (CRP) Qualitative", qual("Result", "Negative"))
add("Prostatic Acid Phosphatase", num("Prostatic Acid Phosphatase", "U/L", 0, 3.5))
add("Serum Cholinesterase level", num("Serum Cholinesterase", "U/L", 3930, 10800))
add("S. BILEACID", num("Serum Bile Acids", "umol/L", 0, 10))
add("AFP", num("Alpha Fetoprotein (AFP)", "ng/mL", None, 10, "< 10"))
add(["CEA", "Carcino Embryonic Antigen-CEA"], num("CEA", "ng/mL", None, 5, "< 5"))
add("ESTIMATED GLOMERULAR FILTRATION RATE(EGFR)", num("eGFR", "mL/min/1.73 m2", 90, None, ">= 90"))
add("Glomerular Filtration Rate- GFR", num("GFR", "mL/min/1.73 m2", 90, None, ">= 90"))
add("CREATININE CLEARANCE TEST - URINE TEST", by_sex("Creatinine Clearance", "mL/min", (97, 137), (88, 128)))
add("Creatinine, 24hrs Urine", by_sex("Creatinine (24 hr urine)", "mg/24 hr", (800, 2000), (600, 1800)))
add("24 HRS URINE PROTEINS", num("Protein (24 hr urine)", "mg/24 hr", None, 150, "< 150"))
add(["24 HOURS URINE MICROALBUMIN", "MICROALBUMINURIA, 24 HR URINE"], num("Microalbumin (24 hr urine)", "mg/24 hr", None, 30, "< 30"))
add("URINE MICRO-ALBUMIN", num("Urine Microalbumin", "mg/L", None, 30, "< 30"))
add("URINE PROTEIN/CREATININE RATIO", num("Urine Protein / Creatinine Ratio", "mg/mg", None, 0.2, "< 0.2"))
add("Urine Alubmin & Creatnine Ratio (ACR)", num("Urine Albumin / Creatinine Ratio", "mg/g", None, 30, "< 30"))
add("OSMOLALITY-URINE", num("Urine Osmolality", "mOsm/kg", 300, 900))
add("VENOUS BLOOD GAS (VBG)", pack(num("pH", None, 7.31, 7.41), num("pCO2", "mmHg", 41, 51), num("pO2", "mmHg", 25, 40), num("HCO3", "mmol/L", 22, 29)))
add(["ABG", "ARTERIAL BLOOD GAS (ABG)"], pack(num("pH", None, 7.35, 7.45), num("pCO2", "mmHg", 35, 45), num("pO2", "mmHg", 80, 100),
                                               num("HCO3", "mmol/L", 22, 26), num("SaO2", "%", 95, 100)))
add(["Apolipoprotein A1 (APO-A1)"], by_sex("Apolipoprotein A1", "mg/dL", (104, 202), (108, 225)))
add(["Apolipoprotein B (APO-B)"], by_sex("Apolipoprotein B", "mg/dL", (66, 133), (60, 117)))
add("Semen Analysis", pack(
    by_sex("Volume", "mL", (1.5, None, ">= 1.5"), None), by_sex("Sperm Concentration", "million/mL", (15, None, ">= 15"), None),
    by_sex("Total Motility", "%", (40, None, ">= 40"), None), by_sex("Normal Morphology", "%", (4, None, ">= 4"), None),
    by_sex("Liquefaction Time", "min", (None, 60, "< 60"), None)))
# Urine / stool / sputum
add(["COMPLETE URINE EXAMINATION(CUE)", "CUE"], CUE)
add(["URINE ALBUMIN", "URINE KETONE", "urine ketone body"], txt("Result", "Negative"))
add(["URINE BS & BP"], pack(txt("Urine Sugar", "Nil"), txt("Bile Pigments", "Absent")))
add(["Fasting Urine Sugar", "Post Prandial Urine Sugar", "Glucose - Fasting/Postprandial, Urine", "PROTEIN (URINE SPOT TEST)"], txt("Result", "Nil"))
add("Urine Pregnancy Test", qual("Result", "Negative"))
add("Stool for Occult Blood", qual("Result", "Negative"))
add("Stool for Reducing Substances", qual("Result", "Negative"))
add("Stool for Hanging Drop", txt("Result"))
add(["Gram Stain"], txt("Gram stain findings"))
add("SPUTUM FOR ACID FAST BACILLI ( AFB )", qual("AFB", "Not seen"))
# Hormones / immunoassay
add("THYROID STIMULATING HORMONE (TSH)", num("TSH (Thyroid Stimulating Hormone)", "uIU/mL", 0.27, 4.2))
add("T3", num("T3 (Total Triiodothyronine)", "ng/dL", 80, 200))
add("T4", num("T4 (Total Thyroxine)", "ug/dL", 5.1, 14.1))
add("T3T4", pack(num("T3 (Total Triiodothyronine)", "ng/dL", 80, 200), num("T4 (Total Thyroxine)", "ug/dL", 5.1, 14.1)))
add(["Thyroid Function Test (TFT)", "THYROID PROFILE I"], THYROID)
add("FT3-TRIIODOTHYRONINE FREE", num("Free T3", "pg/mL", 2.0, 4.4))
add("FT4 (THYROXINE)-SERUM", num("Free T4", "ng/dL", 0.93, 1.7))
add("FT4 & TSH", pack(num("Free T4", "ng/dL", 0.93, 1.7), num("TSH (Thyroid Stimulating Hormone)", "uIU/mL", 0.27, 4.2)))
add("ANTI-TPO AB(ANTITHYROID PEROXIDASE ANTIBODIES)", num("Anti-TPO Antibodies", "IU/mL", None, 35, "< 35"))
add("THYROID ANTIBODIES", pack(num("Anti-TPO Antibodies", "IU/mL", None, 35, "< 35"), num("Anti-Thyroglobulin Antibodies", "IU/mL", None, 40, "< 40")))
add("Anti CCP Antibody", num("Anti-CCP", "U/mL", None, 20, "< 20 (negative)"))
add("Beta Human Chorionic Gonadotropin (BHCG)", num("Beta hCG", "mIU/mL", None, 5, "Non-pregnant < 5"))
add("Beta-2-Microglobulin", num("Beta-2 Microglobulin", "mg/L", 0.8, 2.4))
add("CA -19-9", num("CA 19-9", "U/mL", None, 37, "< 37"))
add("Ca 15.3-Breast Cancer Marker", num("CA 15-3", "U/mL", None, 30, "< 30"))
add("CA-125", num("CA-125", "U/mL", None, 35, "< 35"))
add("Estradiol E2", by_sex("Estradiol (E2)", "pg/mL", (10, 40), (None, None, "Follicular 12-166; Mid-cycle 85-498; Luteal 43-211; Post-menopausal < 54")))
add("Free Testosterone", by_sex("Free Testosterone", "pg/mL", (9, 30), (0.3, 1.9)))
add(["PSA (PROSTATE SPECIFIC ANTIGEN)-Serum", "PSA"], by_sex("PSA (Total)", "ng/mL", (None, 4.0, "< 4.0"), None))
add("Insulin", num("Insulin (Fasting)", "uIU/mL", 2.6, 24.9))
add("Interleukin- 6 (IL - 6)", num("Interleukin-6", "pg/mL", None, 7, "< 7"))
add("LH FSH Prolactin", pack(LH, FSH, PRL))
add(["Luteinizing Hormone (LH)", "LH (LEUTNISING HORMONE)-SERUM"], LH)
add("FSH (FOLLICLE STIMULATING HORMONE)-SERUM", FSH)
add("SERUM PROLACTIN", PRL)
add("Procalcitonin", num("Procalcitonin", "ng/mL", None, 0.5, "< 0.5"))
add("TOTAL IGE", num("Total IgE", "IU/mL", None, 100, "< 100"))
add("TROPONIN - I (Quantity)", num("Troponin I", "ng/mL", None, 0.04, "< 0.04"))
add("Troponin T (Quantity)", num("Troponin T", "ng/mL", None, 0.1, "< 0.1"))
add(["TROPONIN - I (Card)", "Troponin T (Card)"], qual("Result", "Negative"))
add("PARATHYROID HORMONE (PTH)", num("Parathyroid Hormone (PTH)", "pg/mL", 15, 65))
add("Growth Hormone", by_sex("Growth Hormone", "ng/mL", (None, 3.0, "< 3.0"), (None, 8.0, "< 8.0")))
add("Cortisol AM", num("Cortisol (AM)", "ug/dL", 6.2, 19.4))
add("Cortisol PM", num("Cortisol (PM)", "ug/dL", 2.3, 11.9))
add("C-PEPTIDE", num("C-Peptide", "ng/mL", 1.1, 4.4))
add("Nt- ProBNP (N-Terminal Pro B Type Natriuretic Peptide)", num("NT-proBNP", "pg/mL", None, 125, "< 125"))
add(["Double Marker Test", "Triple Marker Test", "Quadruple Marker Test"], pack(txt("Result / risk"), txt("Remarks")))
add("ASO Titre", num("ASO Titre", "IU/mL", None, 200, "< 200"))
add(["Rheumatoid Factor (RA Quantitative)", "Rheumatoid Factor"], num("Rheumatoid Factor", "IU/mL", None, 14, "< 14"))
add(["Rheumatoid Factor (RA Qualitative)", "Blood for RA Factor"], qual("Result", "Negative"))
add("Hepatitis B Surface Antibodies", num("Anti-HBs", "mIU/mL", 10, None, ">= 10 (protective)"))
add("Hepatitis B surface antigen- Quantitative (Anti Hbs)", num("Anti-HBs", "mIU/mL", 10, None, ">= 10 (protective)"))
add("MANTOUX TEST", num("Induration", "mm", None, 10, "< 10 mm negative"))
add("MT MANTOUX", num("Induration", "mm", None, 10, "< 10 mm negative"))
add("WIDAL Test", pack(txt("S. Typhi O", "< 1:80"), txt("S. Typhi H", "< 1:80"), txt("S. Paratyphi AH", "< 1:80"), txt("S. Paratyphi BH", "< 1:80")))
add("DENGUE PROFILE", pack(qual("Dengue NS1 Antigen", "Negative"), qual("Dengue IgM", "Negative"), qual("Dengue IgG", "Negative")))
add("HIV,HBsAG,HCV", pack(qual("HIV", "Non-reactive"), qual("HBsAg", "Non-reactive"), qual("HCV", "Non-reactive")))
add("HIV,HCV,HBsAg", pack(qual("HIV", "Non-reactive"), qual("HCV", "Non-reactive"), qual("HBsAg", "Non-reactive")))
add(["Immunoglobulin M (IgM)"], num("IgM", "mg/dL", 40, 230))
add("Gene Expert", pack(qual("MTB", "Not detected"), qual("Rifampicin resistance", "Not detected")))
add("COVID- 19 ANTIGEN TEST", qual("Result", "Negative"))
# Culture & sensitivity
add(["Urine culture and senstivity", "URINE CULTURE", "Urine Culture", "Blood Culture & Sensitivity", "Motion Culture", "PUS CULTURE TEST", "puss culture",
     "Pus for culture and sensitivity", "Sputum Culture & Sensitivity", "Vaginal Swab for Culture & Sensitivity", "Wound Swab"], CULTURE)
# Histology / cytology / cytogenetics
add(["Histopathology Small", "BIOPSY", "SMALL BIOPSY", "FNAC (Fine needle aspiration cytology)", "PAP SMEAR (GYNEC CYTOLOGY)"],
    pack(txt("Specimen"), txt("Gross description"), txt("Microscopy"), txt("Impression")))
add(["KARYOTYPING", "KARYOTYPING COUPLE", "NIPT"], pack(txt("Result"), txt("Interpretation")))
# Remaining specialised tests & imaging studies (all 293 PDF tests covered)
add("URINE COTININE", qual("Cotinine (Urine)", "Negative (< 200 ng/mL)"))
add("OBS", pack(txt("Obstetric Observation", "Normal"), txt("Impression")))
add("AMH (Anti Mullerian Hormone)", by_sex("AMH (Anti-Mullerian Hormone)", "ng/mL", (1.3, 14.8), (1.0, 4.0)))
add("FREE PSA:TOTAL PSA RATIO", by_sex("Free PSA / Total PSA Ratio", "%", (25.0, None, "> 25 %"), None))
add("MEDICAL EXAMINATION", pack(txt("Medical Examination Findings", "Normal / Fit"), txt("Remarks")))
add("(24HOURS URINE)", pack(num("24-Hour Urine Volume", "mL/24hr", 800, 2000), num("24-Hour Urine Protein", "mg/24hr", None, 150, "< 150")))
add("FLUID ANALYSIS", pack(txt("Appearance", "Clear, straw-coloured"), num("Total WBC Count", "cells/cumm", None, 500, "< 500"), num("Fluid Protein", "g/dL", None, 2.5), num("Fluid Glucose", "mg/dL", 60, 100)))
add("ADA (ADENOSINE DEAMINASE)-BODY FLUID", num("Adenosine Deaminase (ADA)", "U/L", None, 40, "< 40"))
add("ANTINATAL PROFILE", pack(by_sex("Haemoglobin", "g/dL", (13.0, 17.0), (11.5, 15.5)), txt("Blood Group & Rh"), num("Random Blood Sugar (RBS)", "mg/dL", 70, 140), num("TSH", "uIU/mL", 0.4, 4.0), qual("HIV", "Non-reactive"), qual("HBsAg", "Non-reactive"), qual("VDRL", "Non-reactive")))
add("Surgical Profile", pack(by_sex("Haemoglobin", "g/dL", (13.0, 17.0), (12.0, 15.0)), num("Total Leucocyte Count", "cells/cumm", 4000, 11000), num("Platelet Count", "lakhs/cumm", 1.5, 4.5), num("Random Blood Sugar (RBS)", "mg/dL", 70, 140), by_sex("Serum Creatinine", "mg/dL", (0.7, 1.3), (0.6, 1.1)), num("Bleeding Time", "min", 2, 7), num("Clotting Time", "min", 4, 10), qual("HIV", "Non-reactive"), qual("HBsAg", "Non-reactive"), qual("HCV", "Non-reactive")))
add("CREATININE (URINE SPOT TEST)", num("Urine Creatinine (Spot)", "mg/dL", 20, 275))
add("GLUCOSE TOLERANCE TEST (GTT)", pack(num("Fasting Glucose", "mg/dL", 70, 99), num("1-Hour Glucose", "mg/dL", None, 180, "< 180"), num("2-Hour Glucose", "mg/dL", None, 140, "< 140"), qual("Urine Sugar", "Negative")))
add("SAAG", num("Serum-Ascites Albumin Gradient (SAAG)", "g/dL", None, 1.1, "< 1.1 (non-portal); >= 1.1 (portal hypertension)"))
add("FNSC", pack(txt("Specimen"), txt("Cytology / Fluid Findings", "No malignant cells seen"), txt("Impression")))
add("HLA B27", qual("HLA-B27 Antigen", "Negative"))
add("Immature Platelet Fraction (IPF)", num("Immature Platelet Fraction (IPF)", "%", 1.1, 6.1))
add("17 - Hydroxyprogesterone ( 17-OHP)", by_sex("17-Hydroxyprogesterone (17-OHP)", "ng/mL", (0.27, 1.99), (0.15, 2.90)))
add("Androstenedione", by_sex("Androstenedione", "ng/mL", (0.6, 3.1), (0.3, 3.3)))
add("Dihydrotestosterone (DHT)", by_sex("Dihydrotestosterone (DHT)", "pg/mL", (250, 990), (24, 368)))
add("PLGF (Placental Growth Factor)", num("Placental Growth Factor (PlGF)", "pg/mL", 100, None, ">= 100 (low risk)"))
add("Progesterone", by_sex("Progesterone", "ng/mL", (0.1, 0.84), (None, None, "Follicular 0.2-1.5; Luteal 1.7-27.0; Post-menopausal < 0.8")))
add("Protein Electrophoresis", pack(num("Albumin", "g/dL", 3.5, 5.0), num("Alpha-1 Globulin", "g/dL", 0.1, 0.3), num("Alpha-2 Globulin", "g/dL", 0.6, 1.0), num("Beta Globulin", "g/dL", 0.7, 1.2), num("Gamma Globulin", "g/dL", 0.7, 1.6)))
add("Rh Factor (Quantity)", pack(qual("Rh (D) Typing", "Positive / Negative"), txt("Anti-D Titre", "Negative / < 1:16")))
add("Rh Factor (Slide)", qual("Rh (D) Typing", "Positive / Negative"))
# Imaging templates
add("2D ECHO", pack(num("LVEF", "%", 55, 70), txt("Chamber & Valve Findings", "Normal chamber dimensions and valve function"), txt("Impression", "Normal 2D Echo study")))
add("ECG", pack(num("Heart Rate", "bpm", 60, 100), txt("Rhythm", "Normal sinus rhythm"), txt("Impression", "Normal ECG")))
add("NST", pack(num("Baseline Fetal Heart Rate", "bpm", 110, 160), qual("Reactivity", "Reactive"), txt("Impression", "Reactive NST")))
add("observation", pack(txt("Observation Findings", "Stable"), txt("Impression / Notes", "Normal")))

# Qualitative serology not listed above, matched by wording (antibody / antigen / screening tests).
QUALITATIVE_RULES = [
    (re.compile(r"\b(hiv|hcv|hbsag|hepatitis|vdrl|tpha|rapid|screening)\b", re.I), NONREACTIVE),
    (re.compile(r"\b(igg|igm|antibod|antigen|dot|chikungunia|leptospira|scrub|torch|toxoplasma|rubella|measles|mumps|herpes|helicobacter|tb gold|enterocheck|leptocheck|rh antibody|apla|antiphospholipid|lupus|anti nuclear)\b", re.I), NEGATIVE),
]
SEED_NOTE = "Seeded default adult reference range - confirm against the lab's SOP / analyser."


def template_for(service):
    key = normalise(service["name"])
    if key in TEMPLATES:
        return TEMPLATES[key], "template"
    if service["service_type"] == "IMAGING":
        return pack(txt("Findings"), txt("Impression")), "imaging default"
    for pattern, params in QUALITATIVE_RULES:
        if pattern.search(service["name"]):
            return params, "generic qualitative rule"
    return None, "no template"


def seed_parameters(dry_run: bool = False, force: bool = False, db=None, verbose: bool = True) -> dict:
    """Idempotently seed diag_service_parameters (including M / F rows) without deleting or overwriting existing parameters."""
    from database import SessionLocal
    from legacy_queries import get_connection

    owns_db = db is None
    if owns_db:
        db = SessionLocal()
    if verbose:
        print(f"Swecha parameter seed - {'DRY RUN (nothing is written)' if dry_run else 'LIVE'}{' [--force]' if force else ''}")
    summary = {"services_filled": 0, "services_topped_up": 0, "params": 0, "sex_rows": 0}
    skipped_has, skipped_none, skipped_imaging, details = [], [], 0, []
    try:
        with get_connection(db) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, code, name, service_type FROM diag_services WHERE COALESCE(active, TRUE) = TRUE ORDER BY id")
            services = [dict(r) for r in cursor.fetchall()]
            for svc in services:
                params, source = template_for(svc)
                if params is None:
                    if source.startswith("imaging"):
                        skipped_imaging += 1
                    else:
                        skipped_none.append(svc)
                    continue
                cursor.execute("SELECT name, sex_specific FROM diag_service_parameters WHERE service_id = ?", (svc["id"],))
                have = {(normalise(r["name"]), r["sex_specific"] or None) for r in cursor.fetchall()}
                if have and not force:
                    skipped_has.append(svc)
                    continue
                todo = [p for p in params if (normalise(p[0]), p[3]) not in have]
                if not todo:
                    continue
                cursor.execute("SELECT COALESCE(MAX(display_order), -1) AS m FROM diag_service_parameters WHERE service_id = ?", (svc["id"],))
                order = int(cursor.fetchone()["m"]) + 1
                if not dry_run:
                    for name, dtype, unit, sex, low, high, ref_text in todo:
                        cursor.execute(
                            """
                            INSERT INTO diag_service_parameters (
                                service_id, name, data_type, unit, ref_low, ref_high, ref_text, sex_specific, display_order, comments
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (svc["id"], name, dtype, unit, low, high, ref_text, sex, order, SEED_NOTE),
                        )
                        order += 1
                summary["services_topped_up" if have else "services_filled"] += 1
                summary["params"] += len(todo)
                summary["sex_rows"] += sum(1 for p in todo if p[3])
                details.append((svc, len(todo), sum(1 for p in todo if p[3]), source, bool(have)))
            if dry_run:
                conn.rollback()
            else:
                conn.commit()
    except Exception:
        if owns_db:
            db.rollback()
        raise
    finally:
        if owns_db:
            db.close()

    if verbose:
        verb = "would be added" if dry_run else "added"
        print(f"\nActive services checked:            {len(services)}")
        print(f"Services filled (had no parameters): {summary['services_filled']}")
        if force:
            print(f"Services topped up (--force):        {summary['services_topped_up']}")
        print(f"Parameters {verb}:                  {summary['params']}  (of which Male/Female rows: {summary['sex_rows']})")
        print(f"Skipped - already have parameters:   {len(skipped_has)}" + ("" if force else "  (use --force to add missing ones)"))
        print(f"Skipped - imaging tests:             {skipped_imaging}")
        print(f"Skipped - no template (left alone):  {len(skipped_none)}")
        sexual = [d for d in details if d[2]]
        if sexual:
            print("\nTests with separate Male / Female rows:")
            for svc, count, sex_rows, _, _ in sexual:
                print(f"   - {svc['code']} {svc['name']}: {sex_rows} M/F rows of {count}")
        if skipped_none:
            print("\nNo template (enter parameters in Test Catalogue if they need them):")
            for svc in skipped_none:
                print(f"   - {svc['code']} {svc['name']}")
        if dry_run:
            print("\nDry run only - re-run without --dry-run to insert.")

    return {
        "active_services": len(services),
        "services_filled": summary["services_filled"],
        "services_topped_up": summary["services_topped_up"],
        "params_added": summary["params"],
        "sex_rows_added": summary["sex_rows"],
        "skipped_has": len(skipped_has),
        "skipped_none": len(skipped_none),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed diag_service_parameters (with M / F rows) for the catalogue tests (additive only).")
    parser.add_argument("--dry-run", action="store_true", help="Preview only; write nothing.")
    parser.add_argument("--force", action="store_true",
                        help="Also add missing template parameters to services that already have parameters (never deletes or edits existing ones).")
    args = parser.parse_args()
    seed_parameters(dry_run=args.dry_run, force=args.force, verbose=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
