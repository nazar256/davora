export function ThemePrimitiveGallery() {
  return (
    <section aria-label="Theme primitive gallery" className="theme-primitive-gallery">
      <div className="ui-toolbar theme-gallery-toolbar">
        <span aria-hidden="true" className="ui-icon-button">‹</span>
        <span className="ui-toolbar-title">Davora</span>
        <span className="ui-status-indicator success">Ready</span>
      </div>
      <div className="theme-gallery-controls">
        <span className="ui-button primary">Primary</span>
        <span className="ui-button">Secondary</span>
        <span className="ui-chip active">Selected</span>
        <span className="ui-pill">Offline</span>
      </div>
      <label className="ui-field theme-gallery-field">
        <span>Sample field</span>
        <input aria-label="Theme sample field" readOnly value="Design token" />
      </label>
      <div className="ui-list-row">
        <span aria-hidden="true" className="ui-folder-swatch" />
        <span className="ui-list-copy"><strong>Project folder</strong><small>Shared list-row surface</small></span>
        <span aria-hidden="true" className="ui-icon-button">…</span>
      </div>
    </section>
  );
}
