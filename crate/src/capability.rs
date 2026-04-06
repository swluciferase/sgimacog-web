/// capability.rs
/// Capability profile computation from T-scores.
/// Formulas from official document — compiled into WASM binary.

pub struct CapDim {
    pub name:  &'static str,
    pub score: f64,
}

/// Compute 8-dimension capability profile.
/// Returns None for age 4–6 (not applicable).
/// T-scores are u32 (1–99); formula uses them on 0–100 scale directly.
pub fn compute_capability(
    tbr: u32, apr: u32, faa: u32, paf: u32,
    rsa: u32, coh: u32, entp: u32,
    age: u32,
) -> Option<Vec<CapDim>> {
    let (tbr, apr, faa, paf, rsa, coh, entp) = (
        tbr as f64, apr as f64, faa as f64, paf as f64,
        rsa as f64, coh as f64, entp as f64,
    );
    let a = |t: f64| 100.0 - t; // reverse transform

    if age >= 4 && age <= 6 {
        return None;
    }

    let dims: Vec<CapDim> = if age >= 7 && age <= 24 {
        // ── Student (7–24) ──────────────────────────────────────────
        vec![
            CapDim { name: "專注持久力", score: round2(a(tbr)*0.7  + coh*0.3) },
            CapDim { name: "學習敏捷度", score: round2(paf*0.6   + entp*0.4) },
            CapDim { name: "邏輯整合力", score: round2(coh*0.6   + paf*0.4) },
            CapDim { name: "創意發散力", score: round2(entp*0.7  + a(coh)*0.3) },
            CapDim { name: "情緒穩定性", score: round2(faa*0.5   + apr*0.5) },
            CapDim { name: "社交適應力", score: round2(faa*0.6   + entp*0.4) },
            CapDim { name: "考試抗壓力", score: round2(apr*0.7   + a(tbr)*0.3) },
            CapDim { name: "心智續航力", score: round2(a(rsa)*0.6 + paf*0.4) },
        ]
    } else if age >= 25 && age <= 64 {
        // ── Adult / Workplace (25–64) ───────────────────────────────
        vec![
            CapDim { name: "職場執行力", score: round2(a(tbr)*0.6 + paf*0.4) },
            CapDim { name: "決策判斷力", score: round2(faa*0.4   + coh*0.6) },
            CapDim { name: "情緒情商",   score: round2(faa*0.7   + entp*0.3) },
            CapDim { name: "應變靈活性", score: round2(entp*0.6  + a(coh)*0.4) },
            CapDim { name: "壓力復原力", score: round2(apr*0.6   + a(rsa)*0.4) },
            CapDim { name: "系統思考力", score: round2(coh*0.7   + paf*0.3) },
            CapDim { name: "溝通影響力", score: round2(faa*0.6   + a(tbr)*0.4) },
            CapDim { name: "職業續航力", score: round2(a(rsa)*0.5 + apr*0.5) },
        ]
    } else {
        // ── Elderly (65+) ───────────────────────────────────────────
        vec![
            CapDim { name: "認知敏銳度", score: round2(paf*0.5   + a(rsa)*0.5) },
            CapDim { name: "記憶連結力", score: round2(a(rsa)*0.6 + coh*0.4) },
            CapDim { name: "情緒平和度", score: round2(faa*0.4   + apr*0.6) },
            CapDim { name: "生活應變力", score: round2(entp*0.7  + a(coh)*0.3) },
            CapDim { name: "睡眠修復力", score: round2(apr*0.6   + a(tbr)*0.4) },
            CapDim { name: "社交參與度", score: round2(faa*0.6   + entp*0.4) },
            CapDim { name: "感覺整合力", score: round2(coh*0.5   + paf*0.5) },
            CapDim { name: "心智活力度", score: round2(entp*0.6  + a(rsa)*0.4) },
        ]
    };

    Some(dims)
}

#[inline]
fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
