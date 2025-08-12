
/* === PROMPT PATCH v1 — minimal, prompt-only changes === */
/* Drop this after the existing scripts in NipTuck-Beauty-Protocol-v7.3.5.html */

(function(){
  "use strict";

  // 1) Inline instruction spec (strict contract, optimistic scoring, validation)
  window.buildInstructionInline = function(goals){
    var goalsJson = JSON.stringify(Array.isArray(goals) ? goals : []);
    var lines = [
      "STRICT CONTRACT:",
      "• Score exactly 20 criteria (P1..O20) on 1–5 (step 0.25).",
      "• For EACH criterion: (a) score, (b) rationale_140 ≤140 chars ending with 1 micro-fix, (c) 4 expert tips: plastic_surgeon, makeup_artist, health_coach, exec_dating_coach. Never write N/A; if no change, write a 1-sentence Maintain plan.",
      "• PER-IMAGE first: return per_image[] items {image_index, pose:front|three_quarter|profile|unknown, per_criterion: {code:number}, total_weighted:number}. THEN return aggregate.per_criterion as numeric means AND a top-level per_criterion object with detailed {score, rationale_140, tips{...}}.",
      "• DYNAMICS: If no smile/dynamic clip, down-weight Y16–Y18 by 50% in totals and set data_needed:['smile_clip'].",
      "• PERCENTILE: Use priors by sex/age/region; if priors unknown, cap at 97 and set provisional:true.",
      "• 12-WEEK PROTOCOL: Auto from lowest 3 criteria. Weeks1–4 Foundations+Topicals; Weeks5–8 add Aesthetics; Weeks9–12 add Long-Term only if those remain <3.5.",
      "• TONE: Optimistic not gushy; avoid superlatives unless score ≥4.75. Two nice/one hard truth is NOT needed anymore.",
      "• GOALS_SELECTED_JSON: " + goalsJson,
      "• VALIDATE BEFORE RETURN: (a) 20 rationales ≤140, (b) 80 expert tips present, (c) per_image length ≥3, (d) 12-week plan has ≥6 steps in weeks 9–12.",
      "OUTPUT JSON ONLY."
    ];
    return lines.join("\\n");
  };

  // 2) JSON shell sent to the model (schema + rubric anchor labels taken from page spec)
  window.buildPromptJSON = function(inputs, spec, goals){
    return {
      spec_version: "1.0",
      inline_spec: window.buildInstructionInline(goals),
      inputs: {
        sex: inputs.sex,            // 'female'|'male'
        age: inputs.age,            // number
        ethnicity: inputs.ethnicity || "",
        region_standard: inputs.region_standard || "US",
        goals: Array.isArray(inputs.goals) ? inputs.goals : []
      },
      rubric: spec && spec.rubric ? spec.rubric : { criteria: [] },
      llm_output_schema: {
        per_image: [{ image_index:0, pose:"front|three_quarter|profile|unknown", per_criterion:{}, total_weighted:0 }],
        aggregate: { per_criterion: {} },
        per_criterion: {},
        protocol: { weeks_1_4:[], weeks_5_8:[], weeks_9_12:[] },
        percentile: { z:0, pct:0, provisional:false },
        data_needed: []
      }
    };
  };

  // 3) Merge all uploaded images + the single JSON text part into ONE user turn
  window.buildScoringContents = function(params, spec, imageParts){
    try{
      var inputs = {
        sex: params.sex,
        age: params.age,
        ethnicity: params.ethnicity,
        region_standard: params.region_standard,
        goals: Array.isArray(params.goals) ? params.goals : []
      };
      var jsonSpec = window.buildPromptJSON(inputs, spec, inputs.goals);

      var header = [
        "ROLES: Plastic Surgeon, Model Scout, Makeup Artist Expert, Health Coach, Executive & Online Dating Coach.",
        "CALIBRATION: Optimistic but fair. Harmony/symmetry prioritized; clip hype.",
        "TASK: Score 5-bucket/20-criteria rubric (1–5 step 0.25) across 3–5 photos, per-image first, then aggregate; output 4 expert blocks per criterion and a prioritized 12-week protocol."
      ].join("\\n");

      var textPart = { text: header + "\\n" + JSON.stringify(jsonSpec) };
      var parts = Array.isArray(imageParts) ? imageParts.slice() : [];
      parts.push(textPart);

      return [{ role:"user", parts: parts }];
    } catch(e){
      console.error("[PromptPatch] buildScoringContents error:", e);
      // Fallback: text only
      return [{ role:"user", parts: [{ text: JSON.stringify({ error:"buildScoringContents_failed", message: String(e) }) }] }];
    }
  };

  console.log("[PromptPatch] v1 loaded — prompt-only changes active.");
})();
