(() => {
  const body = document.body;
  if (!body) throw Error('FOCUS_CONTROL_UNAVAILABLE');
  const before = document.hasFocus();
  const tabindex = body.getAttribute('tabindex');
  try { body.setAttribute('tabindex','-1'); body.focus({preventScroll:true}); }
  finally { if(tabindex===null) body.removeAttribute('tabindex'); else body.setAttribute('tabindex',tabindex); }
  return {diagnosticOnly:true,virtualDocumentFocus:true,before,after:document.hasFocus(),bodyActive:document.activeElement===body,attributeRestored:body.getAttribute('tabindex')===tabindex};
})()
