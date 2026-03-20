VERSION := $(shell node -p "require('./package.json').version")

PLATFORMS := darwin-arm64 darwin-x64 linux-x64-gnu linux-arm64-gnu win32-x64-msvc

RUST_TARGETS := aarch64-apple-darwin x86_64-apple-darwin x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu x86_64-pc-windows-gnu

PYTHON_DIR := bindings/python

.PHONY: build build-all clean copy-binary prepublish publish publish-platform version
.PHONY: build-python-wheel publish-python clean-python

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

clean: clean-python
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

# ============================================================================
# Python wheel building targets
# ============================================================================
#
# Multi-platform workflow:
#   1. On each platform (macOS, Linux, Windows):
#      $ make build-python-wheel
#      Copy the .whl file from bindings/python/dist/ to a collection directory
#
#   2. On any platform, collect all .whl files into bindings/python/dist/
#
#   3. Publish all wheels at once:
#      $ make publish-python
#
# Requirements:
#   - pip install build twine
#   - PyPI API token (set as TWINE_PASSWORD with TWINE_USERNAME=__token__)
#
# ============================================================================

# Build Python wheel for the CURRENT platform.
# Usage: On each platform, run `make build-python-wheel` to create a platform-specific wheel.
build-python-wheel: build
	@echo "Copying native library to Python package..."
	@mkdir -p $(PYTHON_DIR)/quasar_svm
ifeq ($(shell uname -s),Darwin)
	cp target/release/libquasar_svm.dylib $(PYTHON_DIR)/quasar_svm/
else ifeq ($(OS),Windows_NT)
	cp target/release/quasar_svm.dll $(PYTHON_DIR)/quasar_svm/
else
	cp target/release/libquasar_svm.so $(PYTHON_DIR)/quasar_svm/
endif
	@echo "Building Python wheel for current platform..."
	cd $(PYTHON_DIR) && python -m build --wheel
	@echo "Wheel built in $(PYTHON_DIR)/dist/"
	@echo "Copy this wheel to a collection directory before running on another platform."

# Publish Python wheels to PyPI.
# First, collect all .whl files from different platforms into bindings/python/dist/
# Then run this target to upload them all at once.
# Requires: pip install twine
# Set TWINE_USERNAME and TWINE_PASSWORD env vars, or use __token__ + API token.
publish-python:
	@echo "Publishing Python wheels to PyPI..."
	@echo "Uploading wheels from $(PYTHON_DIR)/dist/:"
	@ls -lh $(PYTHON_DIR)/dist/*.whl
	cd $(PYTHON_DIR) && twine upload dist/*.whl
	@echo "Python package published!"

# Clean Python build artifacts.
clean-python:
	rm -rf $(PYTHON_DIR)/dist $(PYTHON_DIR)/build $(PYTHON_DIR)/*.egg-info
	rm -f $(PYTHON_DIR)/quasar_svm/libquasar_svm.dylib
	rm -f $(PYTHON_DIR)/quasar_svm/libquasar_svm.so
	rm -f $(PYTHON_DIR)/quasar_svm/quasar_svm.dll
