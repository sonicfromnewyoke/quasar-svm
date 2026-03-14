VERSION := $(shell node -p "require('./package.json').version")

PLATFORMS := darwin-arm64 darwin-x64 linux-x64-gnu linux-arm64-gnu win32-x64-msvc

RUST_TARGETS := aarch64-apple-darwin x86_64-apple-darwin x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu x86_64-pc-windows-gnu

.PHONY: build build-all clean copy-binary prepublish publish publish-platform version

build:
	cargo build --release -p quasar-svm-ffi
	npx tsc

# Build native libraries for all platforms, copy to package root + npm dirs.
build-all:
	cargo build --release -p quasar-svm-ffi --target aarch64-apple-darwin
	cargo build --release -p quasar-svm-ffi --target x86_64-apple-darwin
	cargo zigbuild --release -p quasar-svm-ffi --target x86_64-unknown-linux-gnu
	cargo zigbuild --release -p quasar-svm-ffi --target aarch64-unknown-linux-gnu
	cargo zigbuild --release -p quasar-svm-ffi --target x86_64-pc-windows-gnu
	cp target/aarch64-apple-darwin/release/libquasar_svm.dylib  libquasar_svm.dylib
	cp target/x86_64-apple-darwin/release/libquasar_svm.dylib   libquasar_svm_x64.dylib
	cp target/x86_64-unknown-linux-gnu/release/libquasar_svm.so libquasar_svm_x64.so
	cp target/aarch64-unknown-linux-gnu/release/libquasar_svm.so libquasar_svm_arm64.so
	cp target/x86_64-pc-windows-gnu/release/quasar_svm.dll      quasar_svm.dll
	cp target/aarch64-apple-darwin/release/libquasar_svm.dylib  npm/darwin-arm64/libquasar_svm.dylib
	cp target/x86_64-apple-darwin/release/libquasar_svm.dylib   npm/darwin-x64/libquasar_svm.dylib
	cp target/x86_64-unknown-linux-gnu/release/libquasar_svm.so npm/linux-x64-gnu/libquasar_svm.so
	cp target/aarch64-unknown-linux-gnu/release/libquasar_svm.so npm/linux-arm64-gnu/libquasar_svm.so
	cp target/x86_64-pc-windows-gnu/release/quasar_svm.dll      npm/win32-x64-msvc/quasar_svm.dll
	npx tsc
	@echo "All platform binaries built and copied."

clean:
	rm -rf dist target

# Copy a pre-built binary into the correct platform package directory.
# Usage: make copy-binary PLATFORM=darwin-arm64 BINARY=path/to/libquasar_svm.dylib
copy-binary:
ifndef PLATFORM
	$(error PLATFORM is required, e.g. make copy-binary PLATFORM=darwin-arm64 BINARY=path/to/lib)
endif
ifndef BINARY
	$(error BINARY is required, e.g. make copy-binary PLATFORM=darwin-arm64 BINARY=path/to/lib)
endif
	cp $(BINARY) npm/$(PLATFORM)/

# Copy the local build into the current platform's package dir.
copy-local:
ifeq ($(shell uname -s),Darwin)
ifeq ($(shell uname -m),arm64)
	cp target/release/libquasar_svm.dylib npm/darwin-arm64/
else
	cp target/release/libquasar_svm.dylib npm/darwin-x64/
endif
else
ifeq ($(shell uname -m),aarch64)
	cp target/release/libquasar_svm.so npm/linux-arm64-gnu/
else
	cp target/release/libquasar_svm.so npm/linux-x64-gnu/
endif
endif

# Verify that binaries exist before publishing.
prepublish: build
	@for plat in $(PLATFORMS); do \
		count=$$(ls npm/$$plat/*.dylib npm/$$plat/*.so npm/$$plat/*.dll 2>/dev/null | wc -l); \
		if [ $$count -eq 0 ]; then \
			echo "WARNING: no binary in npm/$$plat/"; \
		else \
			echo "OK: npm/$$plat/"; \
		fi \
	done

# Publish a single platform package.
# Usage: make publish-platform PLATFORM=darwin-arm64
publish-platform:
ifndef PLATFORM
	$(error PLATFORM is required)
endif
	cd npm/$(PLATFORM) && npm publish --access public

# Publish all platform packages, then the main package.
publish: prepublish
	@for plat in $(PLATFORMS); do \
		echo "Publishing @blueshift-gg/quasar-svm-$$plat..."; \
		cd npm/$$plat && npm publish --access public && cd ../..; \
	done
	npm publish --access public

# Bump version in all package.json files at once.
# Usage: make version V=0.2.0
version:
ifndef V
	$(error V is required, e.g. make version V=0.2.0)
endif
	node -e "\
		const fs = require('fs'); \
		const files = ['package.json', ...fs.readdirSync('npm').map(d => 'npm/' + d + '/package.json')]; \
		for (const f of files) { \
			const pkg = JSON.parse(fs.readFileSync(f, 'utf8')); \
			pkg.version = '$(V)'; \
			fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + '\n'); \
			console.log('Updated', f, '->', '$(V)'); \
		} \
		const root = JSON.parse(fs.readFileSync('package.json', 'utf8')); \
		if (root.optionalDependencies) { \
			for (const k of Object.keys(root.optionalDependencies)) { \
				root.optionalDependencies[k] = '$(V)'; \
			} \
			fs.writeFileSync('package.json', JSON.stringify(root, null, 2) + '\n'); \
			console.log('Updated optionalDependencies ->', '$(V)'); \
		}"
