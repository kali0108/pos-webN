import { useState } from 'react';

export default function PasswordInput({ value, onChange, placeholder, required, minLength, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        style={{ paddingRight: 66 }}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ position: 'absolute', right: 2, top: 2 }}
        onClick={() => setShow((s) => !s)}
        tabIndex={-1}
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
