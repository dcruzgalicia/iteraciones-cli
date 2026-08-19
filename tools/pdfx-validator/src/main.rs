//! Validador PDF/X-1a para iteraciones-cli.
//!
//! Binario auxiliar invocado por la CLI (Bun) para certificar que los PDF
//! generados con el preamble filter 99-pdfx cumplen PDF/X-1a (ISO 15930-1 /
//! ISO 15930-4). Contrato con la CLI:
//!
//! - `iteraciones-pdfcheck <archivo.pdf>`: valida el PDF contra los niveles
//!   X-1a (2001 y 2003) y acepta si cualquiera pasa; imprime un informe JSON
//!   en stdout y devuelve exit 0 (válido), 2 (no conforme) o 1 (error).
//! - `iteraciones-pdfcheck --version`: imprime la versión del binario.

use std::env;
use std::path::Path;
use std::process::ExitCode;

use pdf_oxide::compliance::{PdfXLevel, PdfXValidator, XComplianceError, XValidationResult};
use pdf_oxide::PdfDocument;
use serde::Serialize;

const BIN_NAME: &str = "iteraciones-pdfcheck";

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

/// Valida contra ambos niveles PDF/X-1a: si cualquiera pasa, el PDF es válido
/// (el paquete LaTeX `pdfx` puede declarar :2001 o :2003 según su versión).
/// Si ninguno pasa, se reporta el informe del primer nivel evaluado (2001).
fn validate(path: &str) -> Result<Report, String> {
    let mut doc =
        PdfDocument::open(Path::new(path)).map_err(|err| format!("no se pudo abrir el PDF: {err}"))?;

    let mut first_failed: Option<Report> = None;
    for level in [PdfXLevel::X1a2001, PdfXLevel::X1a2003] {
        let result = PdfXValidator::new(level)
            .stop_on_first_error(false)
            .include_warnings(true)
            .validate(&mut doc)
            .map_err(|err| format!("error al validar PDF/X-1a: {err}"))?;
        let report = to_report(path, level, &result);
        if report.valid {
            return Ok(report);
        }
        if first_failed.is_none() {
            first_failed = Some(report);
        }
    }
    // Ninguno de los dos niveles pasó: reportar el primero evaluado.
    Ok(first_failed.unwrap_or_else(|| Report {
        file: path.to_string(),
        valid: false,
        level: "PDF/X-1a".to_string(),
        errors: vec![],
        warnings: vec![],
    }))
}

fn to_report(path: &str, level: PdfXLevel, result: &XValidationResult) -> Report {
    Report {
        file: path.to_string(),
        valid: !result.has_errors(),
        level: level.gts_pdfx_version().to_string(),
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
