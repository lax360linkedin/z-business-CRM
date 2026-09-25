import { useForm } from 'react-hook-form'
import { useEffect } from 'react'
import { Modal } from './Modal'
import { FormField, Input, Textarea, Select, DateInput } from './FormField'
import { Button } from './Button'

/**
 * Schema-driven create/edit modal reused across simple CRUD modules.
 * fields: [{ name, label, type: 'text'|'email'|'tel'|'number'|'textarea'|'select'|'date', options?: [{value,label}], required?, placeholder?, span?: 1|2, pattern?: RegExp, patternMessage?: string }]
 */
export function FormModal({ open, onClose, title, description, fields, defaultValues = {}, onSubmit, submitLabel = 'Save', loading = false, size = 'md' }) {
  const { register, handleSubmit, reset, formState: { errors } } = useForm({ defaultValues })

  useEffect(() => {
    if (open) reset(defaultValues)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = (data) => onSubmit(data)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit(submit)} loading={loading}>{submitLabel}</Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(submit)} className="grid grid-cols-2 gap-4">
        {fields.map((f) => (
          <FormField key={f.name} label={f.label} required={f.required} error={errors[f.name]?.message} className={f.span === 1 ? 'col-span-1' : 'col-span-2'}>
            {f.type === 'textarea' ? (
              <Textarea placeholder={f.placeholder} {...register(f.name, { required: f.required && 'This field is required' })} />
            ) : f.type === 'select' ? (
              <Select {...register(f.name, { required: f.required && 'This field is required' })}>
                {!f.required && <option value="">Select…</option>}
                {f.options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </Select>
            ) : f.type === 'date' ? (
              <DateInput {...register(f.name, { required: f.required && 'This field is required' })} />
            ) : (
              <Input
                type={f.type || 'text'}
                placeholder={f.placeholder}
                {...register(f.name, {
                  required: f.required && 'This field is required',
                  pattern: f.pattern && { value: f.pattern, message: f.patternMessage || 'Invalid format' },
                })}
              />
            )}
          </FormField>
        ))}
      </form>
    </Modal>
  )
}
