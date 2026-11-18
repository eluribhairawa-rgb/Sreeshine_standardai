"""Unit tests for the unified lab-result import (CSV layouts, parameter matching, routing).
No database or OCR model needed: model calls are mocked.

Run from backend/:  .venv/bin/python -m unittest tests.test_lab_result_import_unit -v
"""
import os
import sys
import unittest
from unittest import mock

os.environ.setdefault("DATABASE_URL", "postgresql://unit:unit@127.0.0.1:1/unit_tests")
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import file_import as fi  # noqa: E402
import lab_result_import as lri  # noqa: E402

CBC = [
    {"id": 1, "name": "Haemoglobin", "data_type": "numeric", "unit": "g/dL"},
    {"id": 2, "name": "Total Leucocyte Count", "data_type": "numeric"},
    {"id": 3, "name": "Platelet Count", "data_type": "numeric"},
    {"id": 4, "name": "Peripheral Smear", "data_type": "text"},
]


def values(out):
    return {v["parameter_id"]: v["value"] for v in out["values"]}


class LongLayoutTests(unittest.TestCase):
    def test_partner_lab_report_with_preamble_units_and_sections(self):
        csv_bytes = (
            "Apex Diagnostics Pvt Ltd\nPatient: Ravi Kumar\n\n"
            "Investigation,Result,Units,Biological Reference Interval,Flag\n"
            "HAEMATOLOGY,,,,\n"
            "Hb,13.4 g/dL,g/dL,12-16,\n"
            "TLC,\"11,200\",cells/cumm,4000-11000,H\n"
            "Platelets,<20000,/cumm,150000-450000,L\n"
            "Peripheral Smear,Normocytic normochromic,,,\n"
            "Vitamin D,32,ng/mL,30-100,\n"
        ).encode()
        out = lri.import_lab_results("apex.csv", csv_bytes, CBC, patient_name="Ravi Kumar")
        self.assertEqual((out["file_type"], out["processing"], out["layout"]), ("csv", "csv_direct", "long"))
        self.assertEqual(values(out), {1: "13.4", 2: "11200", 4: "Normocytic normochromic"})
        self.assertEqual([s["parameter_id"] for s in out["skipped"]], [3])  # censored "<20000" never filled
        self.assertEqual(out["unmatched"], [])  # Vitamin D is now planned as a new parameter; section heading not reported
        self.assertEqual([(n["name"], n["value"], n["unit"], n["ref_low"], n["ref_high"], n["data_type"]) for n in out["new_parameters"]],
                         [("Vitamin D", "32", "ng/mL", 30.0, 100.0, "numeric")])
        self.assertEqual(out["field_mapping"]["Investigation"], "parameter")
        self.assertTrue(any("Skipped 3 line" in w for w in out["warnings"]))
        self.assertEqual(out["identity_warnings"], [])

    def test_report_for_another_patient_is_rejected_not_filled(self):
        csv_bytes = b"Patient Name;Test Name;Value\nSita Devi;Haemoglobin;9.1\n"
        with self.assertRaises(fi.FileImportError) as ctx:
            lri.import_lab_results("r.csv", csv_bytes, CBC, patient_name="Ravi Kumar")
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("NOT filled", ctx.exception.message)

    def test_matching_patient_name_is_filled(self):
        csv_bytes = b"Patient Name;Test Name;Value\nRavi Kumar;Haemoglobin;9.1\n"
        out = lri.import_lab_results("r.csv", csv_bytes, CBC, patient_name="Ravi Kumar")
        self.assertEqual(values(out), {1: "9.1"})
        self.assertEqual(out["identity_warnings"], [])

    def test_duplicate_parameter_keeps_first_and_warns(self):
        out = lri.import_lab_results("r.csv", b"Test,Result\nHb,13\nHGB,14\n", CBC)
        self.assertEqual(values(out), {1: "13"})
        self.assertTrue(any("more than once" in w for w in out["warnings"]))


class WideLayoutTests(unittest.TestCase):
    def test_analyser_export_picks_this_patients_sample(self):
        csv_bytes = (
            "Sample ID,Date,HGB (g/dL),WBC,PLT,MPV\n"
            "SPC-260101-0001,2026-11-09,10.2,5600,210000,9.1\n"
            "SPC-260101-1234,2026-11-09,13.9,7200,250000,8.8\n"
        ).encode()
        out = lri.import_lab_results("xn.csv", csv_bytes, CBC, specimen_nos=["SPC-260101-1234"])
        self.assertEqual(out["layout"], "wide")
        self.assertEqual(values(out), {1: "13.9", 2: "7200", 3: "250000"})
        self.assertEqual(out["field_mapping"]["HGB (g/dL)"], "parameter: Haemoglobin")
        self.assertEqual(out["field_mapping"]["Date"], "ignore")
        self.assertEqual(out["unmatched"], [])
        self.assertEqual([(n["name"], n["value"]) for n in out["new_parameters"]], [("MPV", "8.8")])
        self.assertEqual(out["sample_id"], "SPC-260101-1234")
        self.assertEqual(out["identity_warnings"], [])

    def test_multiple_rows_without_sample_match_warns(self):
        out = lri.import_lab_results("xn.csv", b"HGB,PLT\n10,1\n11,2\n", CBC)
        self.assertEqual(values(out), {1: "10", 3: "1"})
        self.assertTrue(any("2 sample rows" in w for w in out["warnings"]))


class MatchingTests(unittest.TestCase):
    def test_synonyms_and_bracketed_abbreviations(self):
        m = lri.ParameterMatcher([{"id": 9, "name": "Alanine Aminotransferase (ALT)"}, {"id": 8, "name": "Fasting Blood Sugar"}])
        self.assertEqual(m.match("SGPT")[0]["id"], 9)
        self.assertEqual(m.match("alt")[0]["id"], 9)
        self.assertEqual(m.match("Glucose - Fasting")[0]["id"], 8)
        self.assertIsNone(m.match("Bilirubin")[0])

    def test_ambiguous_match_is_not_guessed(self):
        m = lri.ParameterMatcher([{"id": 1, "name": "Hb"}, {"id": 2, "name": "Haemoglobin"}])
        self.assertEqual(m.match("Hb")[0]["id"], 1)  # exact name wins
        param, reason = m.match("HGB")
        self.assertIsNone(param)
        self.assertIn("more than one", reason)


class RoutingAndErrorTests(unittest.TestCase):
    def test_unrecognised_csv_returns_preview_and_explains(self):
        out = lri.import_lab_results("x.csv", b"Foo,Bar\n1,2\n", CBC)
        self.assertIsNone(out["layout"])
        self.assertEqual(out["values"], [])
        self.assertEqual(out["preview"], [{"Foo": "1", "Bar": "2"}])
        self.assertTrue(any("Could not recognise" in w for w in out["warnings"]))

    def test_errors(self):
        cases = [("x.csv", b"", 400), ("x.csv", b"Test,Result\n", 400), ("x.xlsx", b"PK\x03\x04", 415),
                 ("x.csv", b"a" * (fi.MAX_UPLOAD_BYTES + 1), 413), ("x.pdf", b"not a pdf", 400 if fi.PdfReader else 503)]
        for name, content, status in cases:
            with self.subTest(name=name, status=status), self.assertRaises(fi.FileImportError) as ctx:
                lri.import_lab_results(name, content, CBC)
            self.assertEqual(ctx.exception.status_code, status)

    def test_empty_catalogue_turns_every_result_into_a_new_parameter(self):
        result = lri.import_lab_results("x.csv", b"Test,Result,Unit\nFerritin,45,ng/mL\nVitamin D,18,ng/mL\n", [])
        self.assertEqual([p["name"] for p in result["new_parameters"]], ["Ferritin", "Vitamin D"])

    def test_csv_never_calls_the_model(self):
        with mock.patch.object(lri.qwen_ocr, "_chat") as chat:
            lri.import_lab_results("x.csv", b"Test,Result\nHb,12\n", CBC)
        chat.assert_not_called()

    def test_image_goes_through_ocr_and_keeps_existing_shape(self):
        ocr = {"values": [{"parameter_id": 1, "value": "12.5"}], "skipped": [], "equipment": "XN-1000",
               "patient_name": "Ravi Kumar", "sample_id": ""}
        with mock.patch.object(lri.qwen_ocr, "extract_lab_results", return_value=ocr) as fn:
            out = lri.import_lab_results("scan.JPG", b"\xff\xd8\xff", CBC, "CBC", "Ravi Kumar")
        fn.assert_called_once()
        self.assertEqual((out["file_type"], out["processing"], out["equipment"]), ("image", "ocr_image", "XN-1000"))
        self.assertEqual(out["detected_fields"], ["Haemoglobin"])
        for key in ("values", "skipped", "identity_warnings", "patient_name", "sample_id"):
            self.assertIn(key, out)

    def test_ocr_failures(self):
        empty = {"values": [], "skipped": [], "equipment": "", "patient_name": "", "sample_id": ""}
        for effect, status in ((RuntimeError("down"), 502), (ValueError("bad image"), 400), (empty, 422)):
            kwargs = {"side_effect": effect} if isinstance(effect, Exception) else {"return_value": effect}
            with mock.patch.object(lri.qwen_ocr, "extract_lab_results", **kwargs), self.assertRaises(fi.FileImportError) as ctx:
                lri.import_lab_results("scan.png", b"\x89PNG", CBC)
            self.assertEqual(ctx.exception.status_code, status)


class NewParameterTests(unittest.TestCase):
    def test_ocr_extras_become_new_parameters_and_matched_extras_fill_existing(self):
        ocr = {"values": [{"parameter_id": 1, "value": "12.5"}], "skipped": [], "equipment": "", "patient_name": "", "sample_id": "",
               "additional": [
                   {"name": "Ferritin", "value": "45.2 ng/mL", "unit": "ng/mL", "ref_range": "20 - 250"},
                   {"name": "CRP", "value": "<0.5", "unit": "mg/L", "ref_range": "< 5"},
                   {"name": "PLT", "value": "250000", "unit": "", "ref_range": ""},      # synonym of Platelet Count
                   {"name": "Patient Name", "value": "Ravi", "unit": "", "ref_range": ""},  # not a result
                   {"name": "Ferritin", "value": "46", "unit": "", "ref_range": ""},       # duplicate
                   {"name": "Urine Colour", "value": "Pale yellow", "unit": "", "ref_range": ""}]}
        with mock.patch.object(lri.qwen_ocr, "extract_lab_results", return_value=ocr):
            out = lri.import_lab_results("scan.png", b"\x89PNG", CBC)
        self.assertEqual(values(out), {1: "12.5", 3: "250000"})
        new = {n["name"]: n for n in out["new_parameters"]}
        self.assertEqual(list(new), ["Ferritin", "CRP", "Urine Colour"])
        self.assertEqual((new["Ferritin"]["value"], new["Ferritin"]["data_type"], new["Ferritin"]["ref_low"], new["Ferritin"]["ref_high"]),
                         ("45.2", "numeric", 20.0, 250.0))
        self.assertEqual((new["CRP"]["value"], new["CRP"]["data_type"], new["CRP"]["ref_high"]), ("<0.5", "text", None))
        self.assertEqual(new["Urine Colour"]["data_type"], "text")

    def test_apply_fills_values_for_created_rows(self):
        out = lri.plan_new_parameters({"values": [], "skipped": [], "processing": "ocr_image", "detected_fields": [], "preview": [],
                                       "additional": [{"name": "Ferritin", "value": "45", "unit": "ng/mL", "ref_range": ""}]}, CBC)
        rows = [{"id": 77, "name": "Ferritin", "data_type": "numeric", "unit": "ng/mL", "auto_created": True}]
        lri.apply_new_parameters(out, rows)
        self.assertEqual(values(out), {77: "45"})
        self.assertEqual([p["name"] for p in out["created_parameters"]], ["Ferritin"])
        self.assertEqual(out["detected_fields"], ["Ferritin"])
        # A parameter another upload already added is filled but not reported as created again.
        again = lri.plan_new_parameters({"values": [], "skipped": [], "processing": "csv_direct",
                                         "additional": [{"name": "Ferritin", "value": "9"}]}, CBC)
        lri.apply_new_parameters(again, [{"id": 77, "name": "Ferritin", "data_type": "numeric", "auto_created": True}])
        self.assertEqual(values(again), {77: "9"})

    def test_limits(self):
        extras = [{"name": f"Analyte {chr(65 + i // 26)}{chr(65 + i % 26)}", "value": "1"} for i in range(80)]
        extras.append({"name": "X" * 200, "value": "1"})
        out = lri.plan_new_parameters({"values": [], "skipped": [], "additional": extras}, CBC)
        self.assertEqual(len(out["new_parameters"]), lri.MAX_NEW_PARAMETERS)

    def test_ref_range_parsing(self):
        self.assertEqual(lri._parse_ref_range("13.0 - 17.0 g/dL"), (13.0, 17.0))
        self.assertEqual(lri._parse_ref_range("< 200"), (None, 200.0))
        self.assertEqual(lri._parse_ref_range("> 40"), (40.0, None))
        self.assertEqual(lri._parse_ref_range("Male: 13-17, Female: 12-15"), (None, None))
        self.assertEqual(lri._parse_ref_range("17 - 13"), (None, None))


if __name__ == "__main__":
    unittest.main()
