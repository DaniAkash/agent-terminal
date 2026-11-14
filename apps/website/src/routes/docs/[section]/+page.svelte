<script lang="ts">
import DocsContent from '../DocsContent.svelte'
import type { PageData } from './$types'
let { data }: { data: PageData } = $props()
</script>

<DocsContent section={data.section} />
