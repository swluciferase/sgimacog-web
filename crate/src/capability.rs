/// capability.rs
/// Capability profile computation from T-scores using utility score transform.
/// Formulas from official document v2 — compiled into WASM binary.

pub struct CapDim {
    pub name:  &'static str,
    pub score: f64,
}

// Utility score modes
const CENTERED:       u8 = 0; // ideal ~ 50  (PAF, COH, EnTP)
const HIGH_IS_BETTER: u8 = 1; // ideal ~ 70  (FAA, APR)
const LOW_IS_BETTER:  u8 = 2; // ideal ~ 30  (TBR, RSA)

/// Map a T-score to a quality score (0–100).
///
/// - centered       : bell curve centred at 50, sigma=22
/// - high_is_better : linear 0→70 then penalty above 70
/// - low_is_better  : ideal at 30, penalty below 30, linear decline above
fn utility_score(t: f64, mode: u8) -> f64 {
    let t = t.max(0.0).min(100.0);
    let q = match mode {
        CENTERED => {
            let sigma = 22.0_f64;
            100.0 * (-(t - 50.0).powi(2) / (2.0 * sigma * sigma)).exp()
        }
        HIGH_IS_BETTER => {
            if t > 70.0 {
                100.0 - (t - 70.0) * 1.5
            } else if t > 0.0 {
                100.0 * (t / 70.0)
            } else {
                0.0
            }
        }
        LOW_IS_BETTER => {
            if t < 30.0 {
                100.0 - (30.0 - t) * 1.5
            } else {
                100.0 * (1.0 - (t - 30.0) / 70.0)
            }
        }
        _ => 0.0,
    };
    q.max(0.0)
}

/// Compute 8-dimension capability profile.
/// Returns None for age 4–6 (not applicable).
/// T-scores are u32 (1–99).
pub fn compute_capability(
    tbr: u32, apr: u32, faa: u32, paf: u32,
    rsa: u32, coh: u32, entp: u32,
    age: u32,
) -> Option<Vec<CapDim>> {
    if age >= 4 && age <= 6 {
        return None;
    }

    let (tbr, apr, faa, paf, rsa, coh, entp) = (
        tbr as f64, apr as f64, faa as f64, paf as f64,
        rsa as f64, coh as f64, entp as f64,
    );

    // Per-indicator utility scores
    let q_tbr     = utility_score(tbr,        LOW_IS_BETTER);
    let q_apr     = utility_score(apr,        HIGH_IS_BETTER);
    let q_faa     = utility_score(faa,        HIGH_IS_BETTER);
    let q_paf     = utility_score(paf,        CENTERED);
    let q_rsa     = utility_score(rsa,        LOW_IS_BETTER);
    let q_coh     = utility_score(coh,        CENTERED);
    let q_entp    = utility_score(entp,       CENTERED);
    // Inverted COH for creativity/flexibility dimensions
    let q_coh_inv = utility_score(100.0 - coh, CENTERED);

    let dims: Vec<CapDim> = if age >= 7 && age <= 24 {
        // ── Student (7–24) ──────────────────────────────────────────
        vec![
            CapDim { name: "專注持久力", score: round2(q_tbr*0.7  + q_coh*0.3) },
            CapDim { name: "學習敏捷度", score: round2(q_paf*0.6  + q_entp*0.4) },
            CapDim { name: "邏輯整合力", score: round2(q_coh*0.6  + q_paf*0.4) },
            CapDim { name: "創意發散力", score: round2(q_entp*0.7 + q_coh_inv*0.3) },
            CapDim { name: "情緒穩定性", score: round2(q_faa*0.5  + q_apr*0.5) },
            CapDim { name: "社交適應力", score: round2(q_faa*0.6  + q_entp*0.4) },
            CapDim { name: "考試抗壓力", score: round2(q_apr*0.7  + q_tbr*0.3) },
            CapDim { name: "心智續航力", score: round2(q_rsa*0.6  + q_paf*0.4) },
        ]
    } else if age >= 25 && age <= 64 {
        // ── Adult / Workplace (25–64) ───────────────────────────────
        vec![
            CapDim { name: "職場執行力", score: round2(q_tbr*0.6  + q_paf*0.4) },
            CapDim { name: "決策判斷力", score: round2(q_faa*0.4  + q_coh*0.6) },
            CapDim { name: "情緒情商",   score: round2(q_faa*0.7  + q_entp*0.3) },
            CapDim { name: "應變靈活性", score: round2(q_entp*0.6 + q_coh_inv*0.4) },
            CapDim { name: "壓力復原力", score: round2(q_apr*0.6  + q_rsa*0.4) },
            CapDim { name: "系統思考力", score: round2(q_coh*0.7  + q_paf*0.3) },
            CapDim { name: "溝通影響力", score: round2(q_faa*0.6  + q_tbr*0.4) },
            CapDim { name: "職業續航力", score: round2(q_rsa*0.5  + q_apr*0.5) },
        ]
    } else {
        // ── Elderly (65+) ───────────────────────────────────────────
        vec![
            CapDim { name: "認知敏銳度", score: round2(q_paf*0.5  + q_rsa*0.5) },
            CapDim { name: "記憶連結力", score: round2(q_rsa*0.6  + q_coh*0.4) },
            CapDim { name: "情緒平和度", score: round2(q_faa*0.4  + q_apr*0.6) },
            CapDim { name: "生活應變力", score: round2(q_entp*0.7 + q_coh_inv*0.3) },
            CapDim { name: "睡眠修復力", score: round2(q_apr*0.6  + q_tbr*0.4) },
            CapDim { name: "社交參與度", score: round2(q_faa*0.6  + q_entp*0.4) },
            CapDim { name: "感覺整合力", score: round2(q_coh*0.5  + q_paf*0.5) },
            CapDim { name: "心智活力度", score: round2(q_entp*0.6 + q_rsa*0.4) },
        ]
    };

    Some(dims)
}

#[inline]
fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
