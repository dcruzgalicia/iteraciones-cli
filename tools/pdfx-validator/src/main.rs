//! Validador PDF/X-1a para iteraciones-cli.
//!
//! Binario auxiliar invocado por la CLI (Bun) para certificar que los PDF
//! generados con el preamble filter 99-pdfx cumplen **estrictamente**
//! PDF/X-1a:2001 (ISO 15930-1). Contrato con la CLI:
//!
//! - `iteraciones-pdfcheck <archivo.pdf>`: valida el PDF contra PDF/X-1a:2001;
//!   un PDF es válido SOLO si cumple todo lo requerido por 2001 (no hay
//!   fallback a :2003). Imprime un informe JSON en stdout y devuelve exit 0
//!   (válido), 2 (no conforme) o 1 (error).
//! - `iteraciones-pdfcheck --version`: imprime la versión del binario.

use std::env;
use std::path::Path;
use std::process::ExitCode;

use pdf_oxide::compliance::{PdfXLevel, PdfXValidator, XComplianceError, XValidationResult};
use pdf_oxide::PdfDocument;
use serde::Serialize;

const BIN_NAME: &str = "iteraciones-pdfcheck";

/// Nivel que obliga el proyecto: estrictamente PDF/X-1a:2001. El paquete LaTeX
/// `pdfx` puede declarar :2001 o :2003 según su versión, pero este validador
/// certifica el estándar fijado por el proyecto: 2001 (issue #1964).
const LEVEL: PdfXLevel = PdfXLevel::X1a2001;

#[derive(Serialize)]
struct Issue {
    code: String,
    message: String,
    page: Option<usize>,
    object_id: Option<u32>,
    clause: Option<String>,
}

#[derive(Serialize)]
struct Report {
    file: String,
    valid: bool,
    level: String,
    errors: Vec<Issue>,
    warnings: Vec<Issue>,
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() == 2 && (args[1] == "--version" || args[1] == "-V") {
        println!("{BIN_NAME} {}", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }
    if args.len() != 2 {
        eprintln!("uso: {BIN_NAME} <archivo.pdf>");
        return ExitCode::FAILURE;
    }
    match validate(&args[1]) {
        Ok(report) => {
            println!("{}", serde_json::to_string_pretty(&report).unwrap_or_default());
            if report.valid {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(2)
            }
        }
        Err(err) => {
            eprintln!("{BIN_NAME}: {err}");
            ExitCode::FAILURE
        }
    }
}

/// Valida el PDF contra PDF/X-1a:2001 (único nivel). `valid` es true solo si
/// la validación estricta de 2001 no reporta errores.
fn validate(path: &str) -> Result<Report, String> {
    let mut doc =
        PdfDocument::open(Path::new(path)).map_err(|err| format!("no se pudo abrir el PDF: {err}"))?;

    let result = PdfXValidator::new(LEVEL)
        .stop_on_first_error(false)
        .include_warnings(true)
        .validate(&mut doc)
        .map_err(|err| format!("error al validar PDF/X-1a:2001: {err}"))?;
    Ok(to_report(path, &result))
}

fn to_report(path: &str, result: &XValidationResult) -> Report {
    Report {
        file: path.to_string(),
        valid: !result.has_errors(),
        level: LEVEL.gts_pdfx_version().to_string(),
        errors: result.errors.iter().map(to_issue).collect(),
        warnings: result.warnings.iter().map(to_issue).collect(),
    }
}

fn to_issue(error: &XComplianceError) -> Issue {
    Issue {
        code: format!("{:?}", error.code),
        message: error.message.clone(),
        page: error.page,
        object_id: error.object_id,
        clause: error.clause.clone(),
    }
}
