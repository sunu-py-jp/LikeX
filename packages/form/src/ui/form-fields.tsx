import { useId } from "react";
import type { FormAnswers, FormField, FormValidationIssue, FormValue } from "../model/types";
export function FormFields({ fields, answers, errors, disabled, onChange }: { fields: FormField[]; answers: FormAnswers; errors: FormValidationIssue[]; disabled: boolean; onChange: (id: string, value: FormValue) => void }) {
  const prefix = useId();
  return fields.map(field => {
    const inputId = `${prefix}-${field.id}`, error = errors.find(item => item.fieldId === field.id), value = answers[field.id];
    const attributes = { id: inputId, disabled, required: field.required, "aria-invalid": !!error, "aria-describedby": `${inputId}-help`, placeholder: field.placeholder };
    return <div className="lxf-answer" key={field.id}>
      <label htmlFor={inputId}>{field.label}{field.required && <span className="lxf-required"> *</span>}</label>
      {field.description && <p>{field.description}</p>}
      {field.type === "textarea" ? <textarea {...attributes} value={String(value ?? "")} onChange={event => onChange(field.id, event.target.value)} minLength={field.minLength} maxLength={field.maxLength} />
        : field.type === "select" ? <select {...attributes} value={String(value ?? "")} onChange={event => onChange(field.id, event.target.value)}><option value="">選択してください</option>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : field.type === "radio" ? <fieldset disabled={disabled} aria-label={field.label}>{field.options.map(option => <label key={option.value}><input type="radio" name={inputId} checked={value === option.value} onChange={() => onChange(field.id, option.value)} />{option.label}</label>)}</fieldset>
        : field.type === "checkbox" ? <label className="lxf-check"><input {...attributes} type="checkbox" checked={value === true} onChange={event => onChange(field.id, event.target.checked)} />{field.placeholder || "はい"}</label>
        : <input {...attributes} type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} value={value === null ? "" : String(value ?? "")} min={field.min} max={field.max} minLength={field.minLength} maxLength={field.maxLength} onChange={event => onChange(field.id, field.type === "number" ? event.target.value === "" ? null : Number(event.target.value) : event.target.value)} />}
      <span id={`${inputId}-help`} className="lxf-error">{error?.message}</span>
    </div>;
  });
}
