use std::env;
use std::path::Path;
use std::process::ExitCode;

use pdf_oxide::PdfDocument;
use pdf_oxide::compliance::{PdfXLevel, PdfXValidator, XComplianceError, XValidationResult};
use serde::Serialize;

const BIN_NAME: &str = "iteraciones-pdfcheck";

const LEVEL: PdfXLevel = PdfXLevel::X1a2001;

const PROMOTED_WARNING_CODES: &[&str] = &["XmpMetadataInvalid", "MissingXmpIdentification"];

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

            if report.valid {
                eprintln!("{}: OK PDF/X-1a:2001", report.file);
            } else {
                let n = report.errors.len();
                eprintln!(
                    "{}: no cumple PDF/X-1a:2001 ({} {})",
                    report.file,
                    n,
                    if n == 1 { "fallo" } else { "fallos" }
                );
            }
            for e in &report.errors {
                eprintln!("  [{}] {}{}", e.code, e.message, page_suffix(e.page));
            }
            for w in &report.warnings {
                eprintln!("  [{}] (advertencia) {}{}", w.code, w.message, page_suffix(w.page));
            }
            println!("{}", serde_json::to_string_pretty(&report).unwrap_or_default());
            if report.valid { ExitCode::SUCCESS } else { ExitCode::from(2) }
        }
        Err(err) => {
            eprintln!("{BIN_NAME}: {err}");
            ExitCode::FAILURE
        }
    }
}

fn page_suffix(page: Option<usize>) -> String {
    match page {
        Some(p) => format!(" — página {}", p + 1),
        None => String::new(),
    }
}

fn validate(path: &str) -> Result<Report, String> {
    let mut doc = PdfDocument::open(Path::new(path)).map_err(|err| format!("no se pudo abrir el PDF: {err}"))?;

    let result = PdfXValidator::new(LEVEL)
        .stop_on_first_error(false)
        .include_warnings(true)
        .validate(&mut doc)
        .map_err(|err| format!("error al validar PDF/X-1a:2001: {err}"))?;
    Ok(to_report(path, &result))
}

fn to_report(path: &str, result: &XValidationResult) -> Report {
    let mut errors: Vec<Issue> = result.errors.iter().map(to_issue).collect();
    let warnings: Vec<Issue> = result.warnings.iter().map(to_issue).collect();

    let (promoted, remaining) = partition_promoted(warnings);
    errors.extend(promoted);
    Report {
        file: path.to_string(),
        valid: errors.is_empty(),
        level: LEVEL.gts_pdfx_version().to_string(),
        errors,
        warnings: remaining,
    }
}

fn partition_promoted(warnings: Vec<Issue>) -> (Vec<Issue>, Vec<Issue>) {
    warnings.into_iter().partition(|w| PROMOTED_WARNING_CODES.contains(&w.code.as_str()))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn issue(code: &str) -> Issue {
        Issue {
            code: code.to_string(),
            message: String::new(),
            page: None,
            object_id: None,
            clause: None,
        }
    }

    #[test]
    fn promueve_los_warnings_de_identificacion() {
        let warnings = vec![
            issue("XmpMetadataInvalid"),
            issue("AnnotationNotAllowed"),
            issue("MissingXmpIdentification"),
        ];
        let (promoted, kept) = partition_promoted(warnings);
        let mut codes: Vec<&str> = promoted.iter().map(|w| w.code.as_str()).collect();
        codes.sort_unstable();
        assert_eq!(codes, ["MissingXmpIdentification", "XmpMetadataInvalid"]);
        let kept_codes: Vec<&str> = kept.iter().map(|w| w.code.as_str()).collect();
        assert_eq!(kept_codes, ["AnnotationNotAllowed"]);
    }

    #[test]
    fn sin_warnings_no_promueve_nada() {
        let (promoted, kept) = partition_promoted(vec![]);
        assert!(promoted.is_empty());
        assert!(kept.is_empty());
    }
}
