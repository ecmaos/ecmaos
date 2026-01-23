#include "commands.hpp"
#include <emscripten/console.h>

namespace commands {
    CommandResult rm(const std::string& args) {
        if (args.empty()) {
            return { -1, "Usage: rm <filename>" };
        }

        if (remove(args.c_str()) == 0) {
            return { 0, "" };
        } else {
            return { -1, "Failed to delete file" };
        }
    }
} 