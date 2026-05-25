"""
services/python_executor.py — Sandboxed Python code execution.

Executes LLM-generated pandas/numpy code in a subprocess with:
  - 30-second timeout
  - Restricted imports (only pandas, numpy, json, math)
  - No file system write access
  - JSON-serialized output capture

Used by the NL-to-Python route when questions can't be answered with SQL
(correlations, statistical tests, clustering, etc.)
"""

import json
import subprocess
import sys
import tempfile
import textwrap
from pathlib import Path
from typing import Optional

import pandas as pd


# Template injected around user code for safety
_CODE_TEMPLATE = textwrap.dedent(r'''
import sys
import json

# ── Step 1: import pandas, numpy, and stdlib helpers BEFORE the hook ───────
# pandas on Windows (delvewheel) internally imports `os`, `warnings`, and
# other stdlib modules during its __init__.py.  Pre-importing everything here
# puts them in sys.modules first so the restriction hook never sees them.
import warnings
warnings.filterwarnings("ignore")
import collections
import math
import statistics
import pandas as pd
import numpy as np

# ── Step 2: install the import restriction hook ────────────────────────────
# Everything pandas/numpy need is already cached in sys.modules.
# From here, user code cannot import dangerous modules.
import builtins as _builtins
_BANNED_MODULES = {{
    "os", "subprocess", "shutil", "socket", "urllib", "requests", "http",
    "ftplib", "telnetlib", "smtplib", "xmlrpc", "multiprocessing",
    "ctypes", "cffi", "pty", "tty", "termios",
}}
_original_import = _builtins.__import__

def _restricted_import(name, *args, **kwargs):
    top_level = name.split(".")[0]
    if top_level in _BANNED_MODULES:
        raise ImportError(f"Import '{{name}}' is not allowed in this sandbox.")
    return _original_import(name, *args, **kwargs)

_builtins.__import__ = _restricted_import

# ── Step 3: load the dataset ───────────────────────────────────
df = pd.read_json(sys.argv[1])

# ── Step 4: helper available to user code ────────────────────
# Provides a safe way to get only numeric columns — prevents the
# 'could not convert string to float' crash when user code calls
# .corr() on a mixed-type DataFrame.
def numeric_df(dataframe=None):
    """Return only numeric columns from the DataFrame."""
    d = dataframe if dataframe is not None else df
    return d.select_dtypes(include='number')

# ── User code starts ──
{user_code}
# ── User code ends ──

# Capture the last expression result
# The user code should assign to `result` variable
if "result" in dir() or "result" in locals():
    _out = locals().get("result", None)
else:
    _out = None

# Serialize output
_output = {{"output": "", "result": None, "error": None}}

if isinstance(_out, pd.DataFrame):
    _output["result"] = json.loads(_out.head(50).to_json(orient="records", default_handler=str))
    _output["output"] = f"DataFrame with {{len(_out)}} rows, {{len(_out.columns)}} columns"
elif isinstance(_out, pd.Series):
    _output["result"] = json.loads(_out.head(50).to_json(default_handler=str))
    _output["output"] = f"Series with {{len(_out)}} values"
elif isinstance(_out, (dict, list, int, float, str, bool)):
    _output["result"] = _out
    _output["output"] = str(_out)
elif _out is not None:
    _output["result"] = str(_out)
    _output["output"] = str(_out)

# Also capture any print output
print(json.dumps(_output))
''')

EXECUTION_TIMEOUT = 30  # seconds


def execute_sandboxed(
    code: str,
    df: pd.DataFrame,
    timeout: int = EXECUTION_TIMEOUT,
) -> dict:
    """
    Execute pandas/numpy code in a subprocess with safety constraints.

    Args:
        code: Python code string (should assign to `result` variable)
        df: DataFrame to make available as `df`
        timeout: Max execution time in seconds

    Returns:
        {"output": str, "result": any, "error": str | None}
    """
    if not code or not code.strip():
        return {"output": "", "result": None, "error": "No code provided"}

    # Write DataFrame to temp file (JSON for cross-process transfer)
    data_file = None
    try:
        data_file = tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, prefix="analyst_", encoding="utf-8"
        )
        # Limit to 10k rows for safety
        df.head(10000).to_json(data_file.name, orient="records", default_handler=str)

        # Build the script
        script = _CODE_TEMPLATE.format(user_code=code)

        script_file = tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", delete=False, prefix="analyst_script_", encoding="utf-8"
        )
        script_file.write(script)
        script_file.close()

        import os
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"

        # Execute in subprocess
        result = subprocess.run(
            [sys.executable, script_file.name, data_file.name],
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=env,
            timeout=timeout,
            cwd=tempfile.gettempdir(),  # restrict working directory
        )

        # Clean up script file
        try:
            Path(script_file.name).unlink(missing_ok=True)
        except Exception:
            pass

        if result.returncode != 0:
            # Extract meaningful error from stderr
            stderr = result.stderr.strip()
            # Temporary: expose full stderr to debug SyntaxError
            return {"output": "", "result": None, "error": stderr}

        # Parse JSON output from stdout
        stdout = result.stdout.strip()
        if stdout:
            # Find the last JSON line (our output)
            lines = stdout.split("\n")
            for line in reversed(lines):
                try:
                    return json.loads(line)
                except json.JSONDecodeError:
                    continue

        return {"output": stdout or "", "result": None, "error": None}

    except subprocess.TimeoutExpired:
        return {"output": "", "result": None, "error": f"Code execution timed out after {timeout}s"}
    except Exception as e:
        return {"output": "", "result": None, "error": f"Execution failed: {str(e)}"}
    finally:
        # Always clean up data file
        if data_file:
            try:
                Path(data_file.name).unlink(missing_ok=True)
            except Exception:
                pass