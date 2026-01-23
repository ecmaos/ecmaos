#include "commands.hpp"
#include <emscripten/console.h>
#include <fstream>

namespace commands {
    CommandResult cat(const std::string& args) {
        if (args.empty()) {
            return { -1, "Usage: cat <filename>" };
        }

        std::ifstream file(args, std::ios::binary | std::ios::ate);
        if (!file.is_open()) {
            return { -1, "Failed to open file" };
        }

        std::streamsize size = file.tellg();
        file.seekg(0, std::ios::beg);

        std::string content(size, '\0');
        if (!file.read(&content[0], size)) {
            return { -1, "Failed to read file" };
        }

        return { 0, content };
    }
} 