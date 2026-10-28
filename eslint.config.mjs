export default [{
  languageOptions: { ecmaVersion: 2020, sourceType: "script",
    globals: { window:"readonly",document:"readonly",console:"readonly",localStorage:"readonly",
      sessionStorage:"readonly",fetch:"readonly",setTimeout:"readonly",clearTimeout:"readonly",
      setInterval:"readonly",clearInterval:"readonly",Promise:"readonly",AbortController:"readonly",
      navigator:"readonly",location:"readonly",history:"readonly",alert:"readonly",
      requestAnimationFrame:"readonly",requestIdleCallback:"readonly",caches:"readonly",self:"readonly",
      Worker:"readonly",DOMParser:"readonly",Event:"readonly",KeyboardEvent:"readonly",Blob:"readonly",
      URL:"readonly",FileReader:"readonly",Image:"readonly",DOMException:"readonly",
      NodeFilter:"readonly",getComputedStyle:"readonly",
      GROQ_KEY:"readonly",GEMINI_KEY:"readonly",AI_PROXY:"readonly",aiReasonerExtras:"readonly",
      LOGIN_USER:"readonly",LOGIN_PASS:"readonly",LOGIN_USER2:"readonly",LOGIN_PASS2:"readonly",
      LOGIN_USER3:"readonly",LOGIN_PASS3:"readonly",
      aiFetch:"readonly",aiErrMsg:"readonly",aiReady:"readonly",aiEmbed:"readonly",aiChain:"readonly",
      AI_PROVIDERS:"readonly",withTimeout:"readonly",AI_TIMEOUT_MS:"readonly",
      aiGroundedSearch:"readonly",sqNum:"readonly",extractDeadlines:"readonly",SQ_NUM:"readonly",
      pdfjsLib:"readonly",Tesseract:"readonly",LAW_BASE:"readonly" } },
  rules: { "no-undef":"error" }
}];
