import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { Text, TextInput, View } from 'react-native'
import { z } from 'zod'
import { sendCreateProject } from '@/modules/wss/client'
import { SheetLayout } from './SheetLayout'

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(80),
  path: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  visible: boolean
  onDismiss: () => void
}

// fallow-ignore-next-line complexity
export function NewProjectSheet({ visible, onDismiss }: Props) {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', path: '' },
  })

  const onSubmit = async (values: FormValues) => {
    try {
      const body: import('@/modules/wss/protocol.gen').CreateProjectBody = {
        name: values.name,
      }
      if (values.path) body.path = values.path
      await sendCreateProject(body)
    } catch (err) {
      // The senders' Promise<never> only rejects on OpError; success is
      // observed via the next $session.projects push. Report the reason
      // inline so the user knows why the request bounced.
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
      visible={visible}
      title="New Project"
      onDismiss={onDismiss}
      onSubmit={handleSubmit(onSubmit)}
      submitLabel="Create"
      isSubmitting={isSubmitting}
    >
      <View className="gap-3">
        <View>
          <Text className="mb-1 text-muted-foreground text-xs">Name</Text>
          <Controller
            control={control}
            name="name"
            render={({ field: { value, onChange, onBlur } }) => (
              <TextInput
                autoFocus
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder="Notes"
                className="rounded-md border border-border bg-card px-3 py-2 text-foreground"
              />
            )}
          />
          {errors.name?.message && (
            <Text className="mt-1 text-destructive text-xs">
              {errors.name.message}
            </Text>
          )}
        </View>
        <View>
          <Text className="mb-1 text-muted-foreground text-xs">
            Path (optional)
          </Text>
          <Controller
            control={control}
            name="path"
            render={({ field: { value, onChange, onBlur } }) => (
              <TextInput
                value={value ?? ''}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder="/Users/you/notes"
                autoCapitalize="none"
                autoCorrect={false}
                className="rounded-md border border-border bg-card px-3 py-2 text-foreground"
              />
            )}
          />
        </View>
      </View>
    </SheetLayout>
  )
}
