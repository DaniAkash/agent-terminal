import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Pressable, Text, TextInput, View } from 'react-native'
import { z } from 'zod'
import { sendCreateTab } from '@/modules/wss/client'
import { SheetLayout } from './SheetLayout'

const schema = z.object({
  label: z.string().max(80).optional(),
  cwd: z.string().optional(),
  cmd: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  projectId: string | null
  onDismiss: () => void
}

// fallow-ignore-next-line complexity
export function NewTabSheet({ projectId, onDismiss }: Props) {
  const [advanced, setAdvanced] = useState(false)
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { label: '', cwd: '', cmd: '' },
  })

  // fallow-ignore-next-line complexity
  const onSubmit = async (values: FormValues) => {
    if (!projectId) return
    try {
      const body: import('@/modules/wss/protocol.gen').CreateTabBody = {
        project_id: projectId,
      }
      if (values.label) body.label = values.label
      if (values.cwd) body.cwd = values.cwd
      if (values.cmd) body.cmd = values.cmd
      await sendCreateTab(body)
    } catch (err) {
      setError('label', {
        message: err instanceof Error ? err.message : String(err),
      })
      return
    }
    reset()
    setAdvanced(false)
    onDismiss()
  }

  return (
    <SheetLayout
      visible={projectId !== null}
      title="New Tab"
      onDismiss={onDismiss}
      onSubmit={handleSubmit(onSubmit)}
      submitLabel="Create"
      isSubmitting={isSubmitting}
    >
      <View className="gap-3">
        <View>
          <Text className="mb-1 text-muted-foreground text-xs">
            Label (optional)
          </Text>
          <Controller
            control={control}
            name="label"
            render={({ field: { value, onChange, onBlur } }) => (
              <TextInput
                autoFocus
                value={value ?? ''}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder="shell"
                className="rounded-md border border-border bg-card px-3 py-2 text-foreground"
              />
            )}
          />
          {errors.label?.message && (
            <Text className="mt-1 text-destructive text-xs">
              {errors.label.message}
            </Text>
          )}
        </View>
        <Pressable
          onPress={() => setAdvanced((v) => !v)}
          className="self-start"
        >
          <Text className="text-muted-foreground text-xs">
            {advanced ? '− Hide advanced' : '+ Advanced'}
          </Text>
        </Pressable>
        {advanced && (
          <>
            <View>
              <Text className="mb-1 text-muted-foreground text-xs">
                Starting cwd
              </Text>
              <Controller
                control={control}
                name="cwd"
                render={({ field: { value, onChange, onBlur } }) => (
                  <TextInput
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder="/Users/you/repo"
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="rounded-md border border-border bg-card px-3 py-2 text-foreground"
                  />
                )}
              />
            </View>
            <View>
              <Text className="mb-1 text-muted-foreground text-xs">
                Command (defaults to $SHELL)
              </Text>
              <Controller
                control={control}
                name="cmd"
                render={({ field: { value, onChange, onBlur } }) => (
                  <TextInput
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder="/bin/zsh"
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="rounded-md border border-border bg-card px-3 py-2 text-foreground"
                  />
                )}
              />
            </View>
          </>
        )}
      </View>
    </SheetLayout>
  )
}
