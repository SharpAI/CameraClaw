#!/bin/bash
# Mock docker command for testing CameraClaw
# Simulates: docker info, compose up/down/ps/version, exec (screenshot), cp.

CMD="$1"
shift

case "$CMD" in
  info)
    echo "Server Version: 24.0.0-test"
    echo "Operating System: Test/Mock"
    exit 0
    ;;
  compose)
    # Skip -f <file> and -p <project> flags to get to the actual subcommand
    while true; do
      case "$1" in
        -f|--file|-p|--project-name|--project-directory)
          shift 2  # skip flag and its value
          ;;
        *)
          break
          ;;
      esac
    done
    SUBCMD="$1"
    shift
    case "$SUBCMD" in
      version)
        echo "Docker Compose version v2.27.0-mock"
        exit 0
        ;;
      up)
        echo "Creating mock-openclaw-gateway-1 ... done"
        exit 0
        ;;
      down)
        echo "Stopping mock-openclaw-gateway-1 ... done"
        exit 0
        ;;
      ps)
        if echo "$@" | grep -q "\-q"; then
          echo "mock_container_abc123"
        else
          echo "NAME                        STATUS"
          echo "mock-openclaw-gateway-1     Up 5 minutes"
        fi
        exit 0
        ;;
    esac
    ;;
  exec)
    # docker exec <container> <command...>
    shift  # skip container name
    FULL_CMD="$*"

    if echo "$FULL_CMD" | grep -q "import"; then
      # ImageMagick import — create dummy JPEG at the specified path
      OUTPUT_PATH="${@: -1}"
      mkdir -p "$(dirname "$OUTPUT_PATH")"
      {
        printf '\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
        dd if=/dev/urandom bs=1 count=$((RANDOM % 500 + 500)) 2>/dev/null
        printf '\xff\xd9'
      } > "$OUTPUT_PATH"
      exit 0
    fi
    # rm or other — just succeed
    exit 0
    ;;
  cp)
    # docker cp container:/path /host/path
    SRC="$1"
    DST="$2"
    CONTAINER_PATH="${SRC#*:}"
    if [ -f "$CONTAINER_PATH" ]; then
      cp "$CONTAINER_PATH" "$DST"
    else
      # Create a dummy JPEG at destination
      {
        printf '\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
        dd if=/dev/urandom bs=1 count=$((RANDOM % 500 + 500)) 2>/dev/null
        printf '\xff\xd9'
      } > "$DST"
    fi
    exit 0
    ;;
esac

echo "mock-docker: unknown command $CMD $*" >&2
exit 0
