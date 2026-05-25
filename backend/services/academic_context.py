# DBATU B.Tech Academic Domain Knowledge
# This file provides context for the AI agent when analyzing college/student datasets.
# It is automatically injected into agent prompts when the dataset appears academic.

ACADEMIC_DOMAIN_CONTEXT = """
=== DBATU B.TECH ACADEMIC SYSTEM REFERENCE ===
University: Dr. Babasaheb Ambedkar Technological University (DBATU), Lonere
Program: B.Tech (multiple branches)
Effective: AY 2020-2021

--- CRITICAL: FAIL vs PASS GRADE RULES ---
*** THIS IS THE MOST IMPORTANT SECTION — READ CAREFULLY ***

THE SIMPLE RULE: Below 40 total marks = FAIL. 40 and above = PASS.

FAIL grades (ONLY these — marks below 40 or special cases):
  FF = FAIL (absent, detained, ESE below minimum, or total below 40)

PASS grades (ALL of these are PASS — marks 40 and above):
  EE = PASS (40-50 marks, minimum passing grade, grade point 5.0)
  DE = PASS (51-55 marks)
  DD = PASS (56-60 marks)
  CD = PASS (61-65 marks)
  CC = PASS (66-70 marks)
  BC = PASS (71-75 marks)
  BB = PASS (76-80 marks)
  AB = PASS (81-85 marks)
  AA = PASS (86-90 marks)
  EX = PASS (91-100 marks, highest grade)

SQL RULES:
- For "fail students":   WHERE Grade = 'FF'
- For "pass students":   WHERE Grade != 'FF'
- NEVER include EE in fail — EE means 40-50 marks which is ABOVE 40 = PASS
- The Grade column contains ONLY letter codes: EX, AA, AB, BB, BC, CC, CD, DD, DE, EE, FF
- There is NO literal "Pass" or "Fail" text in the Grade column

--- WHY FF CAN HAVE Total >= 40 ---
A student gets FF even with Total >= 40 if:
  1. ESE (End Semester Exam) marks < minimum (theory: 20/60, practical: varies)
  2. Student was absent (AB) in ESE
  3. Student was detained (attendance < 65%)
So use Grade = 'FF' for fail students (it covers all fail cases including below 40).

--- SEMESTER / YEAR MAPPING ---
First Year  (FE / 1st year):   Sem 1, Sem 2
Second Year (SE / 2nd year):   Sem 3, Sem 4
Third Year  (TE / 3rd year):   Sem 5, Sem 6
Final Year  (BE / 4th year):   Sem 7, Sem 8

Common aliases → correct SQL:
  "first year" / "FE" / "1st year" / "freshman"     → WHERE Sem IN (1, 2)
  "second year" / "SE" / "2nd year" / "sophomore"    → WHERE Sem IN (3, 4)
  "third year" / "TE" / "3rd year" / "junior"        → WHERE Sem IN (5, 6)
  "final year" / "BE" / "4th year" / "fourth year"
    / "btech final" / "last year" / "senior"         → WHERE Sem IN (7, 8)

The Sem column stores INTEGER values (1, 2, 3, ..., 8), not text.
NEVER use Sem = 2 for "second year" — that is semester 2 (first year).
"Second year" ALWAYS means Sem 3 and 4.

--- COURSE NAME PATTERNS (CourseName column) ---
The CourseName column contains FULL official names. Common patterns:
  'Bachelor of Technology (Computer Science and Engineering)' — CSE
  'Bachelor of Technology (Computer Engineering)' — CE
  'B.Tech (Computer Science and Engineering(Artificial Intelligence and Machine Learning))' — CSE AI/ML
  'Bachelor of Technology (Computer Science Engineering(Data Science))' — CSE DS
  'Bachelor of Technology (Electrical Engineering)' — EE
  'B.Tech (Electronics and Telecommunication Engineering)' — EXTC
  'Bachelor of Technology (Mechanical Engineering)' — ME
  'Bachelor of Technology (Civil Engineering)' — Civil
  'Bachelor of Technology (Information Technology)' — IT

When user says "computer science" or "CSE", use:
  WHERE CourseName LIKE '%Computer Science%'
This matches CSE, CSE(AI/ML), CSE(Data Science), etc.
Do NOT use exact match = because the exact string varies.

--- MARKS COLUMNS ---
CA(20) = Continuous Assessment (max 20 for theory)
MSE(20) = Mid Semester Exam (max 20 for theory, may contain '-' for practicals)
ESE(60) = End Semester Exam (max 60 for theory)
Total (100) = Total marks out of 100
Grace Applicable = Grace marks awarded (0 if none)
The column "ESE(60)" may contain 'AB' or 'ABSENT' meaning absent.

--- KEY RULES ---
- Min total for pass: 40/100 (but also need ESE minimum)
- Min ESE for theory: 20/60
- Min CGPA for degree: 5.0
- SGPA = Σ(credits × grade_points) / Σ(credits)
- CGPA = Σ(all_credits × grade_points) / Σ(all_credits)
- Percentage = CGPA × 10
"""


def detect_academic_dataset(schema_text: str) -> bool:
    """
    Detects whether the dataset is likely academic/college data
    by checking for common academic column names in the schema.
    """
    academic_keywords = [
        "grade", "cgpa", "sgpa", "semester", "sem", "marks", "subject",
        "student", "roll", "enrollment", "exam", "ese", "mse", "credits",
        "result", "pass", "fail", "backlog", "atkt", "attendance",
        "division", "class", "department", "branch", "year",
        "coursename", "subjectname", "subjectcode", "coursecode", "prn",
    ]
    schema_lower = schema_text.lower()
    matches = sum(1 for kw in academic_keywords if kw in schema_lower)
    # If 3+ academic keywords found, it's likely academic data
    return matches >= 3
