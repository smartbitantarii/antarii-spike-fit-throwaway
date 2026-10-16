# Build inside the image: no local Go toolchain is needed, which is the point
# of a development-environment repository (GP-009 R5).
#
# golang:1.27.2-alpine — pinned exact, and the tag was verified against the
# Docker registry's own tag list rather than assumed. A floating tag would let
# a later pull change what the spike measured.
FROM golang:1.27.2-alpine AS build
WORKDIR /src
# no dependencies: the stubs use only the standard library, so there is no
# go.sum and nothing to vendor
COPY go.mod ./
COPY main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/stubs .

# scratch rather than alpine: the stubs serve plain HTTP and need no shell,
# no package manager and no CA bundle, so there is nothing to keep
FROM scratch
COPY --from=build /out/stubs /stubs
EXPOSE 8080
ENTRYPOINT ["/stubs"]
