import { ThemedSelect } from './ThemedSelect';

interface EntitySelectOption {
  id: string;
  name: string;
}

interface EntitySelectProps {
  label: string;
  options: EntitySelectOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  required?: boolean;
}

export function EntitySelect({ label, options, value, onChange, placeholder = 'Select...', required }: EntitySelectProps) {
  return (
    <div className="ym-entity-select">
      <span className="block text-xs font-semibold text-secondary mb-1.5 uppercase tracking-wide">
        {label}{required && ' *'}
      </span>
      {options.length > 0 ? (
        <ThemedSelect
          label={label}
          value={value || ''}
          placeholder={placeholder}
          onChange={next => onChange(next || null)}
          options={[{value:'',label:placeholder}, ...options.map(option=>({value:option.id,label:option.name}))]}
        />
      ) : (
        <p className="text-xs text-muted py-2">None available yet.</p>
      )}
    </div>
  );
}
