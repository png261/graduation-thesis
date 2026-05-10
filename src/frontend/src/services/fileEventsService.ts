export type FileEvent = {
  bucket: string
  key: string
  eventName: string
  eventTime: string
  size?: number | null
  eTag?: string | null
  sequencer?: string | null
}

export type FileEntry = {
  key: string
  size?: number | null
  lastModified?: string | null
  eTag?: string | null
}

export type FileContent = {
  key: string
  content: string
  contentType?: string | null
  encoding: "utf-8" | "base64"
  size?: number | null
  lastModified?: string | null
}

const LIST_FILES = `
query ListFiles($prefix: String) {
  listFiles(prefix: $prefix) {
    key
    size
    lastModified
    eTag
  }
}
`

const GET_FILE_CONTENT = `
query GetFileContent($key: String!) {
  getFileContent(key: $key) {
    key
    content
    contentType
    encoding
    size
    lastModified
  }
}
`

const SUBSCRIPTION = `
subscription OnFileEvent {
  onFileEvent {
    bucket
    key
    eventName
    eventTime
    size
    eTag
    sequencer
  }
}
`

function base64Url(input: string) {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function realtimeUrl(graphqlUrl: string, token: string) {
  const url = new URL(graphqlUrl)
  const host = url.host
  const realtimeHost = host.replace("appsync-api", "appsync-realtime-api")
  const header = base64Url(JSON.stringify({ host, Authorization: token }))
  const payload = base64Url("{}")
  return `wss://${realtimeHost}${url.pathname}?header=${header}&payload=${payload}`
}

export async function listFileEntries(
  graphqlUrl: string,
  token: string,
  prefix = ""
): Promise<FileEntry[]> {
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({
      query: LIST_FILES,
      variables: { prefix },
    }),
  })
  if (!response.ok) {
    throw new Error(`File listing failed: ${response.status}`)
  }

  const payload = await response.json()
  if (payload.errors?.length) {
    throw new Error(JSON.stringify(payload.errors))
  }
  return payload.data?.listFiles ?? []
}

export async function getFileContent(
  graphqlUrl: string,
  token: string,
  key: string
): Promise<FileContent> {
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({
      query: GET_FILE_CONTENT,
      variables: { key },
    }),
  })
  if (!response.ok) {
    throw new Error(`File preview failed: ${response.status}`)
  }

  const payload = await response.json()
  if (payload.errors?.length) {
    throw new Error(JSON.stringify(payload.errors))
  }
  if (!payload.data?.getFileContent) {
    throw new Error("File preview returned no content")
  }
  return payload.data.getFileContent
}

export function subscribeToFileEvents(
  graphqlUrl: string,
  token: string,
  onEvent: (event: FileEvent) => void,
  onError: (error: Error) => void
) {
  const socket = new WebSocket(realtimeUrl(graphqlUrl, token), ["graphql-ws"])
  const host = new URL(graphqlUrl).host
  const id = crypto.randomUUID()

  socket.onopen = () => {
    socket.send(JSON.stringify({ type: "connection_init" }))
  }

  socket.onmessage = message => {
    const payload = JSON.parse(message.data)
    if (payload.type === "connection_ack") {
      socket.send(
        JSON.stringify({
          id,
          type: "start",
          payload: {
            data: JSON.stringify({ query: SUBSCRIPTION, variables: {} }),
            extensions: {
              authorization: {
                host,
                Authorization: token,
              },
            },
          },
        })
      )
      return
    }
    if (payload.type === "data") {
      const event = payload.payload?.data?.onFileEvent
      if (event) onEvent(event)
      return
    }
    if (payload.type === "error") {
      onError(new Error(JSON.stringify(payload.payload)))
    }
  }

  socket.onerror = () => onError(new Error("File event subscription failed"))

  return () => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ id, type: "stop" }))
    }
    socket.close()
  }
}
