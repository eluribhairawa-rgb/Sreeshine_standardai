#!/usr/bin/env python3
"""Seed the diagnostic test catalogue from "SWECHA LAB TESTS RATES.pdf" (293 tests, dated 10-08-2026).

Safe by design -- it only ADDS:
  * never deletes, truncates or updates an existing service, rate or pricing-history row;
  * a PDF row is skipped when a service with the same code (SW-nnn) or the same normalised name exists;
  * parameters are only added to a test that has none yet.
It uses the application's own connection (database.SessionLocal -> DATABASE_URL, i.e. the existing
database / container) through legacy_queries.get_connection, so no new database is created.

Usage (from the backend folder):
    python seed_swecha_catalogue.py --dry-run     # preview counts, writes nothing
    python seed_swecha_catalogue.py               # insert (one transaction: all or nothing)
"""
import argparse
import re
import sys

# --------------------------------------------------------------------------------------------
# The PDF: (test name, sample type, price, description) in S.No order (S.No = position, 1..293).
# Department comes from DEPARTMENT_RANGES below.
# --------------------------------------------------------------------------------------------
DEPARTMENT_RANGES = [
    (1, 4, "RADIOLOGY"), (5, 66, "SEROLOGY & IMMUNOLOGY"), (67, 105, "IMMUNOASSAY"),
    (106, 106, "EXAMINATION OF BODY FLUID"), (107, 109, "MOLECULAR BIOLOGY"), (110, 204, "BIOCHEMISTRY"),
    (205, 210, "URINE EXAMINATION"), (211, 240, "HAEMATOLOGY"), (241, 248, "ENDOCRINOLOGY"),
    (249, 250, "Miscellaneous"), (251, 252, "CLINICAL PATHOLOGY"), (253, 264, "MICROBIOLOGY"),
    (265, 265, "COAGULATION STUDY"), (266, 273, "CLINICAL BIOCHEMISTRY"), (274, 275, "SPUTUM EXAMINATION"),
    (276, 279, "HORMONAL ASSAY"), (280, 282, "STOOL EXAMINATION"), (283, 284, "HISTOPATHOLOGY"),
    (285, 288, "Electrolytes"), (289, 291, "PROFILE TEST"), (292, 293, "CYTOLOGY"),
]
IMAGING_SNOS = {1, 2, 3, 4}  # 2D ECHO, ECG, NST, observation

ROWS = [
    # 1-4 RADIOLOGY
    ("2D ECHO", "", 1800, ""), ("ECG", "", 200, ""), ("NST", "DOPPLER", 300, "BABY MOVEMENTS"), ("observation", "observation", 4000, ""),
    # 5-66 SEROLOGY & IMMUNOLOGY
    ("Anti Nuclear Antibodies", "serum", 650, ""), ("ASO Titre", "serum", 400, ""), ("Chikungunia", "serum", 1000, ""),
    ("DENGUE PROFILE", "serum", 1300, ""), ("MANTOUX TEST", "serum", 300, ""), ("HCV -HEPATITIS C VIRUS ANTIBODIES", "", 600, ""),
    ("HCV Rapid", "serum", 300, ""), ("HCV SCREENING TEST", "blood", 300, ""), ("Helicobacter Pylorii IgG", "serum", 700, ""),
    ("Helicobacter Pylorii IgM", "serum", 700, ""), ("Hepatitis A virus - IgG", "serum", 600, ""), ("Hepatitis A virus - IgM", "", 600, ""),
    ("Hepatitis A virus - Total (HAV Total)", "serum", 800, ""), ("Hepatitis B Surface Antibodies", "serum", 500, ""),
    ("Hepatitis B surface antigen", "serum", 500, ""), ("Hepatitis B surface antigen- Quantitative (Anti Hbs)", "serum", 500, ""),
    ("Herpes Simplex Virus (HSV) 1-IgG", "serum", 400, ""), ("Herpes Simplex Virus (HSV) 1-IgM", "serum", 300, ""),
    ("Herpes Simplex Virus (HSV) 2-IgG", "serum", 300, ""), ("Herpes Simplex Virus (HSV) 2-IgM", "serum", 300, ""),
    ("HIV ELISA", "serum", 300, ""), ("HIV I & II", "serum", 300, ""), ("Immunoglobulin M (IgM)", "serum", 600, ""),
    ("Leptospira antibodies", "serum", 1000, ""), ("Measles (Rubeola) Antibody IgG", "serum", 600, ""),
    ("Measles (Rubeola) Antibody IgM", "serum", 600, ""), ("MT MANTOUX", "", 300, ""), ("Mumps Virus Antibody IgG", "serum", 1200, ""),
    ("Mumps Virus Antibody IgM", "serum", 1200, ""), ("RH Antibody Titre", "serum", 300, ""),
    ("Rheumatoid Factor (RA Qualitative)", "serum", 400, ""), ("Rheumatoid Factor (RA Quantitative)", "serum", 400, ""),
    ("Rheumatoid Factor", "serum", 400, ""), ("Rubella -IgG", "serum", 600, ""), ("Rubella -IgM", "serum", 600, ""),
    ("Scrub Typhus", "", 1500, ""), ("Scrub Typhus IgG and IgM", "", 1500, ""), ("Torch IgG", "serum", 700, ""),
    ("Torch IgM", "null", 700, ""), ("Toxoplasma-IgG", "serum", 250, ""), ("Toxoplasma-IgM", "serum", 250, ""),
    ("TPHA (Treponema Pallidum Hemagglutination Assay)", "serum", 400, ""), ("Typhi dot IgG/IgM", "serum", 400, ""),
    ("URINE COTININE", "urine", 400, ""), ("Urine Pregnancy Test", "urine", 200, ""), ("VDRL", "serum", 300, ""),
    ("HIV,HBsAG,HCV", "blood", 900, ""), ("HIV,HCV,HBsAg", "blood", 1000, ""), ("BLOOD FOR HBsAG ESTIMATION", "blood", 300, ""),
    ("WIDAL Test", "serum", 350, ""), ("ABG", "", 2000, ""), ("Blood for RA Factor", "", 300, ""), ("Enterocheck", "", 400, ""),
    ("Serum Cholinesterase level", "", 1000, ""), ("MP", "BLOOD", 200, ""), ("HIV", "", 300, ""), ("HBSAg", "", 300, ""),
    ("T3T4", "BLOOD", 500, "A"), ("OBS", "OBS", 2500, "OBS"), ("puss culture", "", 1500, ""), ("HB%", "", 50, ""),
    ("SERUM FERTIN", "BLOOD", 900, ""),
    # 67-105 IMMUNOASSAY
    ("25 Hydroxy (OH) Vit D", "", 800, ""), ("AMH (Anti Mullerian Hormone)", "serum", 2500, ""), ("Anti CCP Antibody", "serum", 2500, ""),
    ("ANTI-TPO AB(ANTITHYROID PEROXIDASE ANTIBODIES)", "serum", 1500, ""), ("Antiphospholipid Antibodies", "", 1500, ""),
    ("Beta Human Chorionic Gonadotropin (BHCG)", "serum", 800, ""), ("Beta-2-Microglobulin", "serum", 1500, ""),
    ("CA -19-9", "serum", 2500, ""), ("Ca 15.3-Breast Cancer Marker", "serum", 850, ""), ("CA-125", "serum", 1500, ""),
    ("Double Marker Test", "serum", 3600, ""), ("Estradiol E2", "edta wb", 500, ""), ("Ferritin", "serum", 500, ""),
    ("FREE PSA:TOTAL PSA RATIO", "serum", 300, ""), ("Free Testosterone", "serum", 600, ""), ("FT3-TRIIODOTHYRONINE FREE", "", 300, ""),
    ("FT4 (THYROXINE)-SERUM", "", 300, ""), ("FT4 & TSH", "", 400, ""), ("Insulin", "serum", 1000, ""),
    ("Interleukin- 6 (IL - 6)", "serum", 1200, ""), ("LH FSH Prolactin", "", 700, ""), ("Procalcitonin", "serum", 750, ""),
    ("PSA (PROSTATE SPECIFIC ANTIGEN)-Serum", "serum", 600, ""), ("Quadruple Marker Test", "serum", 4000, ""), ("T3", "", 150, ""),
    ("T4", "", 150, ""), ("TB GOLD", "serum", 550, ""), ("Thyroid Function Test (TFT)", "serum", 300, ""),
    ("THYROID STIMULATING HORMONE (TSH)", "serum", 300, ""), ("TOTAL IGE", "serum", 600, ""), ("PSA", "serum", 800, ""),
    ("Triple Marker Test", "serum", 5000, ""), ("TROPONIN - I (Card)", "serum", 1500, ""), ("TROPONIN - I (Quantity)", "serum", 1500, ""),
    ("Troponin T (Card)", "serum", 1500, ""), ("Troponin T (Quantity)", "serum", 1500, ""), ("VITAMIN B12", "", 1200, ""),
    ("VITAMIN D - TOTAL (25-OH-VIT D)- SERUM", "", 2500, ""), ("Vitamin D3 level", "serum", 1200, ""),
    # 106 EXAMINATION OF BODY FLUID, 107-109 MOLECULAR BIOLOGY
    ("MEDICAL EXAMINATION", "", 1000, ""), ("COVID- 19 ANTIGEN TEST", "", 800, ""), ("PTINR", "", 600, ""), ("NIPT", "BLOOD", 14000, "NIPT"),
    # 110-204 BIOCHEMISTRY
    ("(24HOURS URINE)", "urine", 500, ""), ("24 HOURS URINE MICROALBUMIN", "urine", 200, ""), ("24 HRS URINE PROTEINS", "urine", 200, ""),
    ("FLUID ANALYSIS", "Ascitic Fluid", 200, ""), ("FBS & PBLS", "", 100, ""), ("ADA (ADENOSINE DEAMINASE)-BODY FLUID", "body fluid", 250, ""),
    ("ANTINATAL PROFILE", "blood", 1500, ""), ("COMPLETE URINE EXAMINATION(CUE)", "urine", 100, ""), ("Alkaline phosphatase (ALP)", "serum", 200, ""),
    ("ELECTROLYTES", "serum", 500, ""), ("Amylase", "serum", 800, ""), ("Surgical Profile", "serum", 2500, ""),
    ("SMEAR FOR MALARIAL PARASITE (M.P)", "blood", 500, ""), ("RENAL FUNCTION TESTS (RFT)", "blood", 500, ""), ("Semen Analysis", "", 700, ""),
    ("Bilirubin- Total, Direct, Indirect", "serum", 250, ""), ("BLOOD SUGAR (FASTING)", "fluoride plasma", 60, ""),
    ("BLOOD SUGAR (PP)", "fluoride plasma", 60, ""), ("BLOOD SUGAR FASTING & PP (BSF & PP)", "fluoride plasma", 120, ""),
    ("BLOOD SUGAR= RANDOM", "fluoride plasma", 60, ""), ("C- Reactive Protein (CRP) Qualitative", "serum", 300, ""),
    ("C- Reactive Protein (CRP) Quantitative", "serum", 300, ""), ("Cholesterol", "serum", 300, ""), ("COPPER-SERUM", "serum", 300, ""),
    ("CPK MB", "serum", 300, ""), ("Creatine Phosphokinase (CPK)", "serum", 300, ""), ("CREATININE (URINE SPOT TEST)", "urine", 250, ""),
    ("CREATININE CLEARANCE TEST - URINE TEST", "urine", 300, ""), ("Creatinine, 24hrs Urine", "urine", 250, ""),
    ("ESTIMATED GLOMERULAR FILTRATION RATE(EGFR)", "serum", 300, ""), ("Fasting Urine Sugar", "urine", 80, ""), ("Folic Acid", "serum", 300, ""),
    ("Gamma Glutamyl Transferase - GGT/GGTP", "serum", 200, ""), ("Globulin", "", 250, ""), ("Glucose - Fasting/Postprandial, Urine", "", 120, ""),
    ("HbA1c / Glycosylated", "edta wb", 500, ""), ("HDL Cholesterol", "serum", 250, ""), ("Ionic Calcium", "serum", 400, ""),
    ("IRON", "serum", 200, ""), ("Iron Profile Test", "serum", 800, ""), ("IRON STUDIES", "serum", 300, ""),
    ("Lactate Dehydrogenase- Serum (LDH)", "serum", 300, ""), ("LDL Cholesterol", "serum", 300, ""), ("Lipase", "serum", 800, ""),
    ("LIPID PROFILE", "serum", 600, ""), ("LIVER FUNCTION TEST (LFT)", "serum", 500, ""), ("MICROALBUMINURIA, 24 HR URINE", "urine", 800, ""),
    ("Oral Glucose Challenge Test (OGCT)", "serum", 350, ""), ("ORAL GLUCOSE TOLERANCE TEST (OGTT)", "fluoride plasma", 350, ""),
    ("GLUCOSE TOLERANCE TEST (GTT)", "urine", 350, ""), ("OSMOLALITY-URINE", "urine", 600, ""),
    ("POST GLUCOSE BLOOD SUGAR (2HRS)", "fluoride plasma", 100, ""), ("Post Prandial Urine Sugar", "urine", 100, ""),
    ("POTASSIUM (K+)", "serum", 200, ""), ("Prostatic Acid Phosphatase", "serum", 600, ""), ("PROTEIN (URINE SPOT TEST)", "", 400, ""),
    ("Random Blood Sugar Test (RBS)", "fluoride plasma", 100, ""), ("Random Blood Sugar Glucometer (RBS)", "fluoride plasma", 100, ""),
    ("UREA & RBS", "fluoride plasma", 300, ""), ("SAAG", "", 300, ""), ("Serum Calcium", "serum", 300, ""), ("SERUM CREATININE", "", 200, ""),
    ("SERUM CREATININE & RBS", "", 300, ""), ("Magnesium", "serum", 200, ""), ("Serum Transferrin", "serum", 700, ""),
    ("SGOT (AST)- SERUM", "serum", 150, ""), ("SGPT(ALT) - SERUM", "serum", 150, ""), ("Sodium (Na)", "serum", 200, ""),
    ("TORCH PROFILE", "", 5000, ""), ("Total Iron Binding Capacity", "serum", 500, ""), ("Serum Total Protein", "serum", 500, ""),
    ("Transferrin Saturation", "serum", 700, ""), ("Triglycerides", "serum", 100, ""), ("Unsaturated Iron Binding Capacity (UIBC)", "serum", 300, ""),
    ("UREA", "serum", 150, ""), ("Serum URIC ACID", "serum", 300, ""), ("URINE PROTEIN/CREATININE RATIO", "urine", 500, ""),
    ("VLDL Cholesterol", "serum", 300, ""), ("VENOUS BLOOD GAS (VBG)", "", 1500, ""), ("ARTERIAL BLOOD GAS (ABG)", "", 1500, ""),
    ("PTINR", "", 600, ""), ("PTAPTT", "", 600, ""), ("Blood for CRP", "", 300, ""), ("Urine culture and senstivity", "", 1500, ""),
    ("ICT", "BLOOD", 1500, "A"), ("LIQUID PROFILE", "BLOOD", 800, "A"), ("FNSC", "FLUID", 2000, ""), ("S. BILEACID", "BLOOD", 3000, ""),
    ("CEA", "BLOOD SERUM", 1500, ""), ("KARYOTYPING", "BLOOD", 7000, "KARYOTYPING"), ("KARYOTYPING COUPLE", "BLOOD", 7000, "KARYOTYPING"),
    ("APLA", "BLOOD", 4900, "APLA"), ("SERUM AMYLASE", "BLOOD", 700, "AMYLASE"), ("AFP", "BLOOD", 1500, "AFP"), ("LDH", "BLOOD", 800, "LDH"),
    # 205-210 URINE EXAMINATION
    ("URINE ALBUMIN", "", 100, ""), ("URINE BS & BP", "urine", 100, ""), ("URINE KETONE", "", 300, ""), ("URINE MICRO-ALBUMIN", "urine", 400, ""),
    ("URINE CULTURE", "URINE", 800, "UC"), ("urine ketone body", "urine", 500, ""),
    # 211-240 HAEMATOLOGY
    ("Absolute Eosinophils Count (AEC)", "edta wb", 300, ""), ("Complete Blood Picture(CBP)", "", 200, ""),
    ("Bleeding Time & Clotting Time", "edta wb", 100, ""), ("Haemogram", "", 100, ""), ("BLOOD GROUPING", "blood", 300, ""),
    ("Blood Group & Rh factor", "edta wb", 100, ""), ("CD4 Absolute Count", "edta plasma", 1100, ""), ("CD4 Count", "edta plasma", 1000, ""),
    ("Direct Coombs Test (DCT)", "edta wb", 500, ""), ("DLC- Differential Leucocytes Count", "edta wb", 200, ""),
    ("Erythrocyte Sedimentation Rate (ESR)", "", 300, ""), ("Fibrinogen", "edta plasma", 800, ""),
    ("Glucose-6-Phosphate Dehydrogenase", "edta wb", 500, ""), ("Haemoglobin (Hb)", "edta wb", 100, ""),
    ("HAEMOGLOBIN ELECTROPHORESIS (HPLC)", "", 1200, ""), ("HLA B27", "edta wb", 1600, ""), ("Immature Platelet Fraction (IPF)", "edta wb", 5000, ""),
    ("Indirect Coomb's Test (ICT)", "edta wb", 600, ""), ("LE Cells", "", 500, ""), ("LUPUS ANTICOAGULANT", "", 1100, ""),
    ("Malaria Parasite", "edta wb", 300, ""), ("Malarial Antigen", "edta wb", 500, ""), ("Microfilaria Test QBC", "edta wb", 600, ""),
    ("PCV (Haematocrit)", "edta wb", 0, ""), ("Peripheral Blood Smear/ GBP", "edta wb", 600, ""), ("Platelet Count (PL Count)", "edta wb", 150, ""),
    ("Reticulocyte Count", "edta wb", 300, ""), ("Sickling Test", "edta wb", 450, ""), ("TLC- Total Leucocytes Count", "edta wb", 300, ""),
    ("COAGULATION PROFILE", "", 1500, ""),
    # 241-248 ENDOCRINOLOGY, 249-250 Miscellaneous, 251-252 CLINICAL PATHOLOGY
    ("17 - Hydroxyprogesterone ( 17-OHP)", "serum", 1500, ""), ("Androstenedione", "serum", 800, ""), ("C-PEPTIDE", "serum", 1000, ""),
    ("Cortisol AM", "serum", 700, ""), ("Cortisol PM", "serum", 700, ""), ("Dihydrotestosterone (DHT)", "", 2500, ""),
    ("PLGF (Placental Growth Factor)", "", 6000, ""), ("Progesterone", "", 800, ""), ("Carcino Embryonic Antigen-CEA", "", 600, ""),
    ("Nt- ProBNP (N-Terminal Pro B Type Natriuretic Peptide)", "", 2500, ""), ("Glomerular Filtration Rate- GFR", "", 400, ""),
    ("CUE", "URINE", 100, "100"),
    # 253-264 MICROBIOLOGY
    ("Blood Culture & Sensitivity", "wb in culture bottle", 1500, ""), ("Gene Expert", "", 400, ""), ("Motion Culture", "stool", 400, ""),
    ("PUS CULTURE TEST", "", 1000, ""), ("Sputum Culture & Sensitivity", "sputum", 300, ""), ("Urine Alubmin & Creatnine Ratio (ACR)", "urine", 600, ""),
    ("Vaginal Swab for Culture & Sensitivity", "vaginal swab", 1000, ""), ("Wound Swab", "wound swab", 1000, ""),
    ("MALARIAL PARASITE (PF/PV)", "", 400, ""), ("Leptocheck", "", 3000, ""), ("Pus for culture and sensitivity", "", 1500, ""),
    ("SMALL BIOPSY", "SPECIMEN", 2500, "BIOPSY"),
    # 265 COAGULATION STUDY, 266-273 CLINICAL BIOCHEMISTRY
    ("D-Dimer", "sodium citrate 3.2 % plasma specimen", 3000, ""), ("Apolipoprotein A1 (APO-A1)", "serum", 600, ""),
    ("Apolipoprotein B (APO-B)", "serum", 600, ""), ("Protein Electrophoresis", "serum", 1200, ""), ("Rh Factor (Quantity)", "edta wb", 300, ""),
    ("Rh Factor (Slide)", "edta wb", 300, ""), ("Serum Zinc", "serum", 400, ""), ("THYROID ANTIBODIES", "", 800, ""), ("THYROID PROFILE I", "", 500, ""),
    # 274-275 SPUTUM EXAMINATION, 276-279 HORMONAL ASSAY, 280-282 STOOL EXAMINATION
    ("Gram Stain", "sputum", 300, ""), ("SPUTUM FOR ACID FAST BACILLI ( AFB )", "sputum", 600, ""), ("Growth Hormone", "serum", 650, ""),
    ("Luteinizing Hormone (LH)", "serum", 350, ""), ("PARATHYROID HORMONE (PTH)", "serum", 1000, ""), ("APLA PROFLIE", "BLOOD", 5000, "5000"),
    ("Stool for Hanging Drop", "stool", 400, ""), ("Stool for Occult Blood", "stool", 400, ""), ("Stool for Reducing Substances", "stool", 400, ""),
    # 283-284 HISTOPATHOLOGY, 285-288 Electrolytes, 289-291 PROFILE TEST, 292-293 CYTOLOGY
    ("Histopathology Small", "", 800, ""), ("BIOPSY", "SPESMEN", 4000, ""), ("Chlorides", "serum", 200, ""), ("Electrolytes Panel", "serum", 500, ""),
    ("PHOSPHROUS (PO4)", "serum", 200, ""), ("Sodium Potassium (Na,K)", "serum", 400, ""),
    ("FSH (FOLLICLE STIMULATING HORMONE)-SERUM", "", 750, ""), ("LH (LEUTNISING HORMONE)-SERUM", "", 750, ""), ("SERUM PROLACTIN", "", 750, ""),
    ("FNAC (Fine needle aspiration cytology)", "", 1000, ""), ("PAP SMEAR (GYNEC CYTOLOGY)", "", 1500, ""),
]

# --------------------------------------------------------------------------------------------
# Standard adult parameter sets for the major panels. (name, data_type, unit, ref_low, ref_high, ref_text)
# Ranges are generic adult defaults -- the lab should confirm them against its analyser / SOP.
# --------------------------------------------------------------------------------------------
N, T = "numeric", "text"
CBC_PARAMS = [
    ("Haemoglobin", N, "g/dL", 13.0, 17.0, None), ("Total Leucocyte Count", N, "cells/cumm", 4000, 11000, None),
    ("Neutrophils", N, "%", 40, 80, None), ("Lymphocytes", N, "%", 20, 40, None), ("Eosinophils", N, "%", 1, 6, None),
    ("Monocytes", N, "%", 2, 10, None), ("Basophils", N, "%", 0, 1, None), ("Platelet Count", N, "lakh/cumm", 1.5, 4.5, None),
    ("RBC Count", N, "million/cumm", 4.5, 5.5, None), ("Packed Cell Volume (PCV)", N, "%", 40, 50, None),
    ("MCV", N, "fL", 83, 101, None), ("MCH", N, "pg", 27, 32, None), ("MCHC", N, "g/dL", 31.5, 34.5, None),
    ("RDW-CV", N, "%", 11.6, 14.0, None), ("Peripheral Smear", T, None, None, None, None),
]
LFT_PARAMS = [
    ("Total Bilirubin", N, "mg/dL", 0.2, 1.2, None), ("Direct Bilirubin", N, "mg/dL", 0.0, 0.3, None),
    ("Indirect Bilirubin", N, "mg/dL", 0.2, 0.9, None), ("SGOT (AST)", N, "U/L", 5, 40, None), ("SGPT (ALT)", N, "U/L", 5, 40, None),
    ("Alkaline Phosphatase (ALP)", N, "U/L", 44, 147, None), ("Total Protein", N, "g/dL", 6.0, 8.3, None),
    ("Albumin", N, "g/dL", 3.5, 5.2, None), ("Globulin", N, "g/dL", 2.0, 3.5, None), ("A/G Ratio", N, None, 1.0, 2.2, None),
]
RFT_PARAMS = [
    ("Urea", N, "mg/dL", 17, 43, None), ("Blood Urea Nitrogen (BUN)", N, "mg/dL", 8, 23, None), ("Creatinine", N, "mg/dL", 0.7, 1.3, None),
    ("Uric Acid", N, "mg/dL", 3.5, 7.2, None), ("Sodium", N, "mmol/L", 135, 145, None), ("Potassium", N, "mmol/L", 3.5, 5.1, None),
    ("Chloride", N, "mmol/L", 98, 107, None),
]
LIPID_PARAMS = [
    ("Total Cholesterol", N, "mg/dL", None, 200, "< 200 (desirable)"), ("Triglycerides", N, "mg/dL", None, 150, "< 150"),
    ("HDL Cholesterol", N, "mg/dL", 40, None, "> 40"), ("LDL Cholesterol", N, "mg/dL", None, 100, "< 100 (optimal)"),
    ("VLDL Cholesterol", N, "mg/dL", 2, 30, None), ("Cholesterol / HDL Ratio", N, None, None, 5.0, "< 5.0"),
]
ELECTROLYTE_PARAMS = [
    ("Sodium", N, "mmol/L", 135, 145, None), ("Potassium", N, "mmol/L", 3.5, 5.1, None), ("Chloride", N, "mmol/L", 98, 107, None),
]
NAK_PARAMS = ELECTROLYTE_PARAMS[:2]
THYROID_PARAMS = [
    ("T3 (Total Triiodothyronine)", N, "ng/dL", 80, 200, None), ("T4 (Total Thyroxine)", N, "ug/dL", 5.1, 14.1, None),
    ("TSH (Thyroid Stimulating Hormone)", N, "uIU/mL", 0.27, 4.2, None),
]
CUE_PARAMS = [
    ("Colour", T, None, None, None, "Pale yellow"), ("Appearance", T, None, None, None, "Clear"),
    ("Specific Gravity", N, None, 1.005, 1.030, None), ("pH", N, None, 4.6, 8.0, None),
    ("Protein (Albumin)", T, None, None, None, "Nil"), ("Glucose", T, None, None, None, "Nil"), ("Ketones", T, None, None, None, "Nil"),
    ("Bilirubin", T, None, None, None, "Negative"), ("Urobilinogen", T, None, None, None, "Normal"), ("Blood", T, None, None, None, "Negative"),
    ("Nitrite", T, None, None, None, "Negative"), ("Pus Cells", T, "/HPF", None, None, "0 - 5"),
    ("Epithelial Cells", T, "/HPF", None, None, "0 - 4"), ("RBCs", T, "/HPF", None, None, "Nil"), ("Casts", T, None, None, None, "Nil"),
    ("Crystals", T, None, None, None, "Nil"), ("Bacteria", T, None, None, None, "Nil"),
]

# Normalised test name -> parameter set.
PANELS = {
    "complete blood picture cbp": CBC_PARAMS, "haemogram": CBC_PARAMS,
    "liver function test lft": LFT_PARAMS, "renal function tests rft": RFT_PARAMS,
    "lipid profile": LIPID_PARAMS, "liquid profile": LIPID_PARAMS,
    "electrolytes": ELECTROLYTE_PARAMS, "electrolytes panel": ELECTROLYTE_PARAMS, "sodium potassium na k": NAK_PARAMS,
    "thyroid function test tft": THYROID_PARAMS, "thyroid profile i": THYROID_PARAMS,
    "complete urine examination cue": CUE_PARAMS, "cue": CUE_PARAMS,
}
PARAM_NOTE = "Seeded default adult range (Swecha catalogue seed) - confirm against the analyser / lab SOP."
SEED_USER = "swecha_seed"


def normalise(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(name or "").lower()).strip()


def build_catalogue():
    """The 293 PDF rows as service dicts with deterministic codes SW-001..SW-293."""
    assert len(ROWS) == 293, f"expected 293 rows, found {len(ROWS)}"
    services = []
    for sno, (name, sample, price, desc) in enumerate(ROWS, start=1):
        department = next(d for lo, hi, d in DEPARTMENT_RANGES if lo <= sno <= hi)
        if department.isupper():
            department = department.title().replace(" Of ", " of ")
        sample = "" if sample.strip().lower() in ("", "null") else sample.strip()
        is_imaging = sno in IMAGING_SNOS
        specimen = sample or None
        # Sample Type, else a wordy Description, is the specimen for lab tests (codes / numbers are not specimens).
        if not specimen and not is_imaging and desc and re.search(r"[A-Za-z]{3,}", desc) and normalise(desc) != normalise(name):
            specimen = desc.strip()
        services.append({
            "sno": sno, "code": f"SW-{sno:03d}", "name": name.strip(), "norm": normalise(name),
            "service_type": "IMAGING" if is_imaging else "LAB", "department": department,
            "specimen_type": None if is_imaging else specimen,
            "modality": (sample or None) if is_imaging else None,
            "rate": float(price),
        })
    return services


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed the diagnostic catalogue from the Swecha rate list (additive only).")
    parser.add_argument("--dry-run", action="store_true", help="Preview what would be inserted; write nothing.")
    parser.add_argument("--fill-existing-params", action="store_true",
                        help="Also add the standard parameters to tests that already exist in the catalogue but have none "
                             "(off by default: existing services are never touched).")
    args = parser.parse_args()

    # Imported here so --help works without a database.
    from database import SessionLocal
    from legacy_queries import get_connection

    catalogue = build_catalogue()
    db = SessionLocal()
    mode = "DRY RUN (nothing is written)" if args.dry_run else "LIVE"
    print(f"Swecha catalogue seed - {mode}")
    try:
        with get_connection(db) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, code, name FROM diag_services")
            by_code, by_name = {}, {}
            seeded_here = {}   # normalised name -> code inserted earlier in this same run
            for row in cursor.fetchall():
                by_code[row["code"]] = row["id"]
                by_name.setdefault(normalise(row["name"]), row["id"])

            inserted, skipped_code, skipped_name = [], [], []
            params_new = params_existing = 0
            params_for_existing = []   # (service name, count)
            for svc in catalogue:
                existing_id = None
                reason = None
                if svc["code"] in by_code:
                    existing_id, reason = by_code[svc["code"]], "code already exists"
                elif svc["norm"] in by_name:
                    existing_id, reason = by_name[svc["norm"]], "a service with this name already exists"

                if existing_id is None:
                    service_id = None
                    if not args.dry_run:
                        cursor.execute(
                            """
                            INSERT INTO diag_services (
                                code, name, service_type, department, active, specimen_type, modality,
                                requires_scheduling, report_template, rate, created_by
                            ) VALUES (?, ?, ?, ?, TRUE, ?, ?, FALSE, 'generic', ?, ?)
                            """,
                            (svc["code"], svc["name"], svc["service_type"], svc["department"], svc["specimen_type"],
                             svc["modality"], svc["rate"], SEED_USER),
                        )
                        service_id = cursor.lastrowid
                        cursor.execute(
                            "INSERT INTO diag_service_pricing_history (service_id, rate, payer_type, changed_by) VALUES (?, ?, 'standard', ?)",
                            (service_id, svc["rate"], SEED_USER),
                        )
                    # Later rows in this same run see it, so a repeated test name in the PDF is not inserted twice.
                    by_code[svc["code"]] = service_id or -svc["sno"]
                    by_name.setdefault(svc["norm"], service_id or -svc["sno"])
                    seeded_here.setdefault(svc["norm"], svc["code"])
                    inserted.append(svc)
                    has_params = False
                else:
                    if svc["norm"] in seeded_here and reason != "code already exists":
                        reason = f"repeated test name in the PDF (same as {seeded_here[svc['norm']]})"
                    (skipped_code if reason == "code already exists" else skipped_name).append((svc, reason, existing_id))
                    service_id = existing_id
                    has_params = None
                    if not args.fill_existing_params:
                        continue   # existing services are left completely untouched

                panel = PANELS.get(svc["norm"])
                if not panel:
                    continue
                if has_params is None:
                    cursor.execute("SELECT COUNT(*) AS c FROM diag_service_parameters WHERE service_id = ?", (service_id,))
                    has_params = int(cursor.fetchone()["c"] or 0) > 0
                if has_params:
                    continue
                if not args.dry_run and service_id:
                    for order, (pname, dtype, unit, low, high, ref_text) in enumerate(panel):
                        cursor.execute(
                            """
                            INSERT INTO diag_service_parameters (
                                service_id, name, data_type, unit, ref_low, ref_high, ref_text, display_order, comments
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (service_id, pname, dtype, unit, low, high, ref_text, order, PARAM_NOTE),
                        )
                if existing_id is None:
                    params_new += len(panel)
                else:
                    params_existing += len(panel)
                    params_for_existing.append((svc["name"], len(panel)))

            if args.dry_run:
                conn.rollback()
            else:
                conn.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    verb = "would be inserted" if args.dry_run else "inserted"
    skipped = len(skipped_code) + len(skipped_name)
    print(f"\nTests in the PDF:         {len(catalogue)}")
    print(f"Tests {verb}:  {len(inserted)}  (IMAGING {sum(1 for s in inserted if s['service_type'] == 'IMAGING')}, "
          f"LAB {sum(1 for s in inserted if s['service_type'] == 'LAB')})")
    print(f"Tests skipped (exist):    {skipped}")
    for svc, reason, existing_id in skipped_code + skipped_name:
        print(f"   - {svc['code']} {svc['name']!r}: {reason}" + (f" (service id {existing_id})" if existing_id and existing_id > 0 else ""))
    print(f"Parameters {verb} for new tests:      {params_new}")
    if args.fill_existing_params:
        print(f"Parameters {verb} for existing tests: {params_existing} (only tests that had none)")
    else:
        print("Existing tests: not touched (use --fill-existing-params to add standard parameters to existing tests that have none)")
    for name, count in params_for_existing:
        print(f"   - {name}: {count}")
    if args.dry_run:
        print("\nDry run only - re-run without --dry-run to insert.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
