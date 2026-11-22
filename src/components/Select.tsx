import { useLayoutEffect, useRef, useState, type SelectHTMLAttributes, type ChangeEvent } from 'react';
import { ThemedSelect, type ThemedSelectOption } from './ThemedSelect';

/** Native-select compatible bridge so every platform picker shares one accessible popup. */
export function Select({ children, className = '', onChange, value, defaultValue, id, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const native = useRef<HTMLSelectElement>(null);
  const ariaLabel = props['aria-label'];
  const title = props.title;
  const [options, setOptions] = useState<ThemedSelectOption[]>([]);
  const [label, setLabel] = useState(props['aria-label'] || props.title || 'Choose an option');
  const [internalValue, setInternalValue] = useState(String(defaultValue ?? ''));
  useLayoutEffect(() => {
    const node = native.current;
    if (!node) return;
    setOptions(Array.from(node.options, option => ({ value: option.value, label: option.text, disabled: option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled) })));
    const explicitLabel = id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`) : null;
    const nearbyLabel = node.parentElement?.previousElementSibling;
    const enclosingLabel = node.closest('label');
    const text = explicitLabel?.textContent || enclosingLabel?.querySelector('span')?.textContent || (nearbyLabel?.tagName === 'LABEL' ? nearbyLabel.textContent : null);
    setLabel(ariaLabel || title || text?.trim() || node.options[0]?.text || 'Choose an option');
  }, [children, id, ariaLabel, title]);
  const current = String(value ?? internalValue);
  return <div className={`ym-select-bridge ${className.replace(/\binput-field\b/g, '')}`}>
    <select {...props} ref={native} value={current} onChange={() => {}} tabIndex={-1} aria-hidden="true" className="ym-select-native-bridge">
      {children}
    </select>
    <ThemedSelect id={id} label={label} value={current} options={options} disabled={props.disabled} required={props.required} describedBy={props['aria-describedby']}
      onChange={next => {
        setInternalValue(next);
        const node = native.current;
        if (!node) return;
        node.value = next;
        // Existing form handlers read the real select target, including numeric values and selectedOptions.
        const event = new Event('change', { bubbles: true });
        Object.defineProperties(event, { target: { value: node }, currentTarget: { value: node } });
        onChange?.(event as unknown as ChangeEvent<HTMLSelectElement>);
      }} />
  </div>;
}
