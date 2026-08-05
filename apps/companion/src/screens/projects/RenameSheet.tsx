import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Text, TextInput } from 'react-native'
import { z } from 'zod'
import { sendRenameProject, sendRenameTab } from '@/modules/wss/client'
import { SheetLayout } from './SheetLayout'

const schema = z.object({
  name: z.string().min(1, 'Required').max(80),
})

type FormValues = z.infer<typeof schema>

export type RenameTarget =
  | { kind: 'project'; projectId: string; currentName: string }
  | {
      kind: 'tab'
      projectId: string
      tabId: string
      currentLabel: string
    }

interface Props {
  target: RenameTarget | null
  onDismiss: () => void
}

// fallow-ignore-next-line complexity
export function RenameSheet({ target, onDismiss }: Props) {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  })

  // fallow-ignore-next-line complexity
  useEffect(() => {
    let cancelled = false
    if (target === null) {
      if (!cancelled) reset({ name: '' })
      return () => {
        cancelled = true
      }
    }
    const seed =
      target.kind === 'project' ? target.currentName : target.currentLabel
    if (!cancelled) reset({ name: seed })
    return () => {
      cancelled = true
    }
  }, [target, reset])

  // fallow-ignore-next-line complexity
  const onSubmit = async (values: FormValues) => {
    if (!target) return
    try {
      if (target.kind === 'project') {
        await sendRenameProject({
          project_id: target.projectId,
          new_name: values.name,
        })
      } else {
        await sendRenameTab({
          project_id: target.projectId,
          tab_id: target.tabId,
          new_label: values.name,
        })
      }
    } catch (err) {
      setError('name', {
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }
    reset()
    onDismiss()
  }

  return (
    <SheetLayout
      visible={target !== null}
      title={target?.kind === 'project' ? 'Rename Project' : 'Rename Tab'}
      onDismiss={onDismiss}
      onSubmit={handleSubmit(onSubmit)}
      submitLabel="Save"
      isSubmitting={isSubmitting}
    >
      <Controller
        control={control}
        name="name"
        render={({ field: { value, onChange, onBlur } }) => (
          <TextInput
            autoFocus
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            className="rounded-md border border-border bg-card px-3 py-2 text-foreground"
          />
        )}
      />
      {errors.name?.message && (
        <Text className="mt-1 text-destructive text-xs">
          {errors.name.message}
        </Text>
      )}
    </SheetLayout>
  )
}
